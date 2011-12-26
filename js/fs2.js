var can_download = true;
var concurrencyKey = +new Date;
function check_download(){
  can_download = true;
  localStorage.checkConcurrency = concurrencyKey;
}
check_download();
onstorage = function(e){
  if(e.key == "checkConcurrency"){
    if(can_download){
      if(+e.newValue < +concurrencyKey){
        can_download = false;
      }else{
        localStorage.checkConcurrency = concurrencyKey;
      }
    }
  }
}


function blobSlice(blob, start, length){
	if(blob.webkitSlice){
		return blob.webkitSlice(start, start + length);
	}else if(blob.slice){
		if(!blobType) testSliceType();
		if(blobType == 1){
			return blob.slice(start, length);
		}else if(blobType == 2){
			return blob.slice(start, start + length);
		}
	}
}

function createBlobBuilder(){
	if(window.BlobBuilder){
		return new BlobBuilder()
	}else if(window.WebKitBlobBuilder){
		return new WebKitBlobBuilder();
	}
}
/*
  What exactly is this?
  
  Well, first let's discuss what exactly offline-wiki needs to do
  in order to get a better picture of what hole this fills.
  
  Offline Wiki needs to work offline, that's a pretty big feature.
  I don't think that needs explanation, but I feel like giving an
  explanation anyway. Or maybe not. Okay, I changed my mind. Maybe
  I'll change my mind again if I think of a good excuse to waste
  your time like that.
  
  Offline Wiki runs in the browser, something which is usually online.
  This is actually part of the calling of the project, because browsers
  are exceedingly useless while offline, and this sort of brings a 
  vague semblance of utility to something which usually becomes useless.
  
  However, this prompts an interesting challenge, for Offline Wiki must
  maintain reasonable utility while online and offline. So then, a virtual
  filesystem with multiple supporting backends becomes useful.
  
  At least one layer of abstraction would make sense, since you can do
  a binary search on a networked file just as well as a local file. It
  would also be useful to treat the local file as a sort of cache, so 
  that all data which comes from the great fluffy panda in the sky is
  recorded for posterity.
  
  But then another layer of abstraction becomes useful because Firefox
  doesn't implement the FileSystem API, while Chrome's implementation of
  IndexedDB crashes (the entire browser!) when you try saving some typed
  arrays (I dont know specifics, I was too bored to investigate).
  
  This Virtual File API also uses a bitset to calculate download progress
  quickly. The bitset is really just a lightweight representation of whatever
  is saved. The only use of this is for the popcount function, which takes
  that bitset and counts the number of downloaded chunks in order to generate
  a purty progress bar.
  
  I guess that bitset may also be useful for calculating the 'most recently
  downloaded article', which is a cool feature that totally needs to be 
  implemented in the next version which employs this backend.
  
  Since compression algorithms require a definite start/finish which may not
  necessarily align with the chunk boundaries (which are absolutely arbitrary
  by the way), it needs a layer of abstraction above the readChunk method.
  
  This is the readBlock method. It returns a block which is a unit of data
  always less than the size of the chunk. Sometimes it needs to read two chunks
  in order to get the necessary amount of data. Maybe in the future, readBlock
  will be able to handle non-fixed sizes for blocks and maybe even blocks larger
  than the chunk.
  
  It calls readChunk once or twice in order to get the data and neatly trims
  and slices it until it is fit to be returned.
  
  So yeah, here you have it. Hybrid online/offline virtual files.

*/
function VirtualFile(name){
  var chunksize = 512 * 1024;
  var blocksize = 200 * 1024; //blocksize must be < chunksize
  var defaultsize = 1024 * 1024 * 1024 + 1;
  var initialized = false;
  var file, fileEntry, db;
  

  function setbit(n){
    bitfield[~~(n/8)] = bitfield[~~(n/8)] | (1 << (n % 8));
    localStorage[name+'_bitset'] = b64();
  }
  function getbit(n){
    return ((bitfield[~~(n/8)] & (1 << (n % 8))) >> (n % 8));
  }
  function checkbit(n){
    if(!getbit(n)){
      console.log("warning! inconsistency for bit ", n);
      setbit(n);
    }
  }
  var bits_in_char = new Uint8Array(256);
  for(var i = 0; i < 256; i++){
    bits_in_char[i] = i.toString(2).replace(/0/g, '').length;
  }
  function popcount(){
    for(var i = 0, s = 0; i < bitfield.length; i++) s += bits_in_char[bitfield[i]];
    return s;
  }
  var D = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/=";
  function b64(){
    var B = bitfield;
    var s = '';
    for(var i = 0; i < B.length; i += 3){
      var a = B[i], b = B[i + 1], c = B[i + 2];
      s += D[a >> 2] + D[((a & 3) << 4) | (b >> 4)] + D[((b & 15) << 2) | (c >> 6)] + D[c & 63];
    }
    return s;
  }
  function d64(s){
    //beware: can not handle non-padded strings properly
    var B = new Uint8Array(Math.ceil(s.length/4 * 3));
    for(var i = 0, j = 0; i < s.length; i += 4, j += 3){
      var a = D.indexOf(s[i]), b = D.indexOf(s[i+1]), c = D.indexOf(s[i+2]), d = D.indexOf(s[i+3]);
      B[j] = (a << 2) | (b >> 4);
      B[j+1] = ((b & 15) << 4) | (c >> 2);
      B[j+2] = ((c & 3) << 6) | d;
    }
    return B
  }
  
  var size = 1025405491;
  var chunks = Math.ceil(size/chunksize);
  var bitfield = new Uint8Array(Math.ceil(Math.ceil(chunks/8)/3)*3);
  var dec = d64("" + localStorage[name+'_bitset']);
  if(dec.length == bitfield.length){
    bitfield = dec;
  }else{
    console.log("warning! bitset invalid. building new one.", bitfield.length);
  }
  
  
  function errorHandler(f){ 
    console.log(f);
  }
	var rfs = (window.requestFileSystem||window.webkitRequestFileSystem);
	if(rfs && false){
	  if(window.webkitStorageInfo){
    	webkitStorageInfo.requestQuota(webkitStorageInfo.PERSISTENT, defaultsize,
        function(grantedQuota){
          console.log("Granted quota:", grantedQuota)
      	  rfs(window.PERSISTENT, defaultsize, function(filesystem){
	        	filesystem.root.getFile(name, {create:true, exclusive: false}, function(e){
	        	  fileEntry = e;
		          e.file(function(f){
		            file = f;
			          initialized = true;
		          })
	          }, errorHandler);
	        }, errorHandler);
        }, 
        function(e){
          console.log("Quota Request error:", e)
        }); 
    }
	}else{
    var indexedDB = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB;
    if ('webkitIndexedDB' in window) {
      window.IDBTransaction = window.webkitIDBTransaction;
      window.IDBKeyRange = window.webkitIDBKeyRange;
    }
    var req = indexedDB.open(name);
    req.onsuccess = function(e){
      var v = '2.718';
      db = e.target.result;
      if(v != db.version){
        var setVrequest = db.setVersion(v);
        setVrequest.onsuccess = function(e){
          var store = db.createObjectStore('fs', {keyPath: 'chunk'});
          initialized = true;
        }
      }else{
        initialized = true;
      }
    }
	}


  function readBlock(position, callback){
    if(!initialized) return setTimeout(function(){
      readBlock(position, callback);
    }, 100);
    var chunk = Math.floor(position/chunksize);
    var first = chunksize - (position % chunksize);
    var result = new Uint8Array(blocksize);
    readChunk(chunk, function(ab){
      if(ab == false) return callback(false);
      result.set(ab.subarray(position % chunksize, (position % chunksize) + blocksize), 0);
      if(first < blocksize){
        //request second chunk
        readChunk(chunk + 1, function(ab){
          if(ab == false) return callback(false);
          result.set(ab.subarray(0, blocksize - first), first);
          callback(result);
        })
      }else{
        callback(result);
      }
    })
  }

  function readChunk(chunk, callback){
    console.log("reading chunk", chunk);
    readChunkPersistent(chunk, function(e){
      if(e == false){
        if(getbit(chunk)) console.log('inconsistency arghleflarg');
        
        readChunkXHR(chunk, function(e){
          console.log("read from XHR");
          callback(e);
          if(e != false){
            writeChunkPersistent(chunk, e);
          }
        });
      }else{
        console.log("read from persistent store");
        checkbit(chunk);
        callback(e);
      }
    });
  }
  
  function readChunkPersistent(chunk, callback){
    //readChunkFile(chunk, callback);
    readChunkDB(chunk, callback);
  }
  
  function writeChunkPersistent(chunk, data){
    //writeChunkFile(chunk, data);
    writeChunkDB(chunk, data);
  }
  
  function writeChunkFile(chunk, data){
		fileEntry.createWriter(function(fileWriter) {
			fileWriter.seek(chunksize * chunk);
			var bb = createBlobBuilder();
			bb.append(data.buffer);
			var blob = bb.getBlob();
			fileWriter.write(blob);
			setbit(chunk);
			console.log("wrote another chunk", popcount());
		})
  }
  function writeChunkDB(chunk, data){
    var trans = db.transaction(['fs'], IDBTransaction.READ_WRITE);
    var store = trans.objectStore('fs');
    var req = store.put({
      data: data, //'i am a cow',//data.buffer,
      chunk: chunk
    });
    req.onsuccess = function(){
      setbit(chunk);
      console.log('wrote another chunk (current count)', popcount());
    }
    req.onerror = function(e){
      console.log('write error', e);
    }
  }
  function readChunkFile(chunk, callback){
    var fr = new FileReader();
    fr.onload = function(){
      var t = new Uint8Array(fr.result);
      if(t[2] || t[3] || t[5] || t[7] || t[11] || t[13] || t[17]){
        callback(t);
      }else{
        callback(false);
      }
    }
    fr.readAsArrayBuffer(blobSlice(file, chunksize * chunk, blocksize));
  }

  function readChunkDB(chunk, callback){
    var trans = db.transaction(['fs'], IDBTransaction.READ_ONLY);
    var store = trans.objectStore('fs');
    var keyRange = IDBKeyRange.only(chunk);
    var cursorRequest = store.openCursor(keyRange);
    cursorRequest.onsuccess = function(e){
      var result = e.target.result;
      if(!!result == false){
        return callback(false);
      }
      //console.log(result);
      callback(result.value.data);
    }
  }
  

  function readChunkXHR(chunk, callback){
  	var xhr = new XMLHttpRequest();
	  xhr.open('GET', '/Downloads/split2/pi.index', true);
	  xhr.setRequestHeader('Range', 'bytes='+(chunk * chunksize)+'-'+((chunk + 1) * chunksize));
  	xhr.responseType = 'arraybuffer';
	  xhr.onload = function(){
	    callback(new Uint8Array(xhr.response));
	  }
	  xhr.onerror = function(){
	    callback(false);
	  }
	  xhr.send(null);
  }
  
  function reset(){
    resetDB(); 
  }
  
  function resetDB(){
    var req = db.setVersion('0.1');
    req.onsuccess = function(){
      db.deleteObjectStore('fs');
    }
  }
  return {
    readBlock: readBlock,
    popcount: popcount,
    reset: reset
  };
}

var cow = VirtualFile('supertest');

