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
  
  So yeah, here you have it. Hybrid online/offline virtual files. I should totally
  rework this to be more object-orient-ish.
*/

function VirtualFile(name, size, chunksize, network){
  //var chunksize = 2 * 1024 //512 * 1024;
  //var blocksize = 1 * 1024 //200 * 1024; //blocksize must be < chunksize
  var defaultsize = 1024 * 1024 * 1024 + 1;
  var initialized = false;
  var file, fileEntry, db;
  
  function testSliceType(){
	  var bb = createBlobBuilder();
	  bb.append("elitistland");
	  var number = bb.getBlob().slice(3,5).size;
	  if(number == 5){
		  blobType = 1
	  }else if(number == 2){
		  blobType = 2;
	  }else{
		  alert("Apparently the future, assuming you are in the future, is really messed up by mid-2011 standards.");
	  }
  }

  
  function blobSlice(blob, start, length){
    if(blob.webkitSlice){
      return blob.webkitSlice(start, start + length);
    }else if(blob.mozSlice){
      return blob.mozSlice(start, start + length);
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
  
  var chunks = Math.ceil(size/chunksize);
  var bitfield = new Uint8Array(Math.ceil(Math.ceil(chunks/8)/3)*3);
  var dec = d64("" + localStorage[name+'_bitset']);
  if(dec.length == bitfield.length){
    bitfield = dec;
  }else{
    console.log("warning! bitset invalid. building new one.", bitfield.length);
  }
  
  function checkBlock(position){
    var c = Math.floor(position / chunksize);
    return getbit(c);
  }
  
  function errorHandler(f){ 
    console.log(f);
  }
  var rfs = (window.requestFileSystem||window.webkitRequestFileSystem);
  if(rfs && window.webkitStorageInfo){
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
  
  function readBlock(position, blocksize, callback){
    var result = new Uint8Array(blocksize);
    var delta = 0;
    position = Math.max(0, position);
    function readPart(){
      var chunk = Math.floor(position/chunksize);
      readChunk(chunk, function(ab){
        if(ab == false) return callback(false);
        var ta = new Uint8Array(ab);
        var offset = position % chunksize;
        var arr = ta.subarray(offset, offset + result.length - delta);
        result.set(arr, delta);
        delta += arr.length;
        position += arr.length;
        //console.log(offset, chunk, delta, arr.length, result.length, ab.length);
        if(delta < result.length){
          if(arr.length == 0){
            //callback(false);
            callback(result.buffer);
          }else{
            readPart()
          }
        }else{
          callback(result.buffer);
        }
      })
    }
    readPart();
  }
  
  function readText(position, blocksize, callback){
    readBlock(position, blocksize, textReader(callback))
  }
  
  function textReader(callback){
    return function(buffer){
      if(buffer == false){
        callback(false)
      }else{
        var bb = createBlobBuilder();
        bb.append(buffer);
        var fr = new FileReader();
        fr.onload = function(){
          callback(fr.result);
        }
        fr.onerror = function(e){
          console.debug("file read error");
          console.error(e)
        }
        fr.readAsText(bb.getBlob())
      }
    }
  }
  
  function readChunkText(chunk, callback){
    readChunk(chunk, textReader(callback));
  }

  function readChunk(chunk, callback, redownload){
    if(!initialized) return setTimeout(function(){
      readChunk(chunk, callback, redownload);
    }, 100);
    chunk = Math.max(0, chunk);
    //console.log("reading chunk", chunk, name);
    readChunkPersistent(chunk, function(e){
      if(e == false || redownload){
        if(getbit(chunk)) console.log('inconsistency arghleflarg');
        downloadContiguousChunks(chunk, 2, function(e){
          callback(e);
          //console.log('read from network store');
        });
      }else{
        //console.log("read from persistent store", name);
        checkbit(chunk);
        callback(e);
      }
    });
  }
  
  function downloadContiguousChunks(start, maximum, callback){
    var end = start + 1; //read minimum of one chunk
    while(!getbit(end) && (end - start) < maximum && end < chunks) end++;
    console.log('reading', end-start,'chunks starting at',start);
    readChunksXHR(start, end - start, function(e){
      //console.log("read from XHR", name, chunk);
      if(e != false) writeChunksPersistent(start, e);
      
      callback(e);
    });
    
  }
  
  function readChunkPersistent(chunk, callback){
    if(fileEntry){
      readChunkFile(chunk, callback);
    }else if(db){
      readChunkDB(chunk, callback);
    }else{
      callback(false); 
    }
  }
  
  function writeChunksPersistent(chunk, data){
    if(fileEntry){
      writeChunksFile(chunk, data);
    }else if(db){
      var bb = createBlobBuilder();
      bb.append(data);
      var blob = bb.getBlob();
      for(var i = 0; i < data.byteLength; i += chunksize){
        writeChunkDB(chunk + i, blobSlice(blob, i * chunksize, chunksize));
      }
    }
  }
  
  
  
  function writeChunksFile(chunk, data){
    fileEntry.createWriter(function(fileWriter) {    
      if(fileWriter.readyState != 0){
        console.debug("sopmething weird happened, readySTate not zero", fileWriter.readyState);
      }
      
      function writeData(){
        fileWriter.seek(chunksize * chunk);
        fileWriter.write(blob);
        fileWriter.onwrite = function(){
          //console.log(data.byteLength);
          for(var i = 0; i < data.byteLength; i += chunksize){
            setbit(chunk + i/chunksize);
            //console.log("wrote chunk", chunk + i/chunksize);
          }
          //console.log("wrote another chunk", popcount());
        }
      }
      var bb = createBlobBuilder();
      bb.append(data);
      var blob = bb.getBlob();
      
      if(chunksize * chunk > fileWriter.length){
        fileWriter.truncate(chunksize * chunk);
        fileWriter.onwrite = function(){
          writeData();
        }
      }else writeData();
    })
  }
  function writeChunkDB(chunk, data){
    var trans = db.transaction(['fs'], IDBTransaction.READ_WRITE);
    var store = trans.objectStore('fs');
    var req = store.put({
      data: data,
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
        callback(fr.result);
      }else callback(false);
    }
    fr.onerror = function(e){
      console.debug("file read error at read file chunk");
      console.error(e)
    }
    fr.readAsArrayBuffer(blobSlice(file, chunksize * chunk, chunksize));
  }

  function readChunkDB(chunk, callback){
    var trans = db.transaction(['fs'], IDBTransaction.READ_ONLY);
    var store = trans.objectStore('fs');
    var keyRange = IDBKeyRange.only(chunk);
    var cursorRequest = store.openCursor(keyRange);
    cursorRequest.onsuccess = function(e){
      var result = e.target.result;
      if(!!result == false) return callback(false);
      
      //console.log(result);
      var fr = new FileReader();
      fr.onload = function(){
        callback(fr.result);
      }
      fr.readAsArrayBuffer(result.value.data);
      //callback(result.value.data);
    }
  }
  
  function readChunkXHR(chunk, callback){
    readChunksXHR(chunk, chunksize, callback);
  }
  
  function readChunksXHR(chunk, size, callback){
    //return callback(false); //simulate offline
    
    var xhr = new XMLHttpRequest();
    var url = network(chunk * chunksize);
    xhr.open('GET', url[0], true);
    xhr.setRequestHeader('Range', 'bytes='+url[1]+'-'+(url[1] + chunksize*size));
    xhr.responseType = 'arraybuffer';
    xhr.onload = function(){
      if(xhr.status >= 200 && xhr.status < 300 && xhr.readyState == 4){
        callback(xhr.response);
      }else{
        callback(false);
      }
    }
    xhr.onerror = function(){
      callback(false);
    }
    xhr.send(null);
  }
  
  function reset(){
    if(db){
      resetDB(); 
    }else if(fileEntry){
      resetFile();
    }
    localStorage[name+'_bitset'] = '';
  }
  
  function resetFile(){
    fileEntry.remove(function(){
      console.log("removed file")
    })
  }
  
  function resetDB(){
    var req = db.setVersion('0.1');
    req.onsuccess = function(){
      db.deleteObjectStore('fs');
    }
  }
  return {
    readBlock: readBlock,
    readText: readText,
    readChunkText: readChunkText,
    popcount: popcount,
    checkBlock: checkBlock,
    checkChunk: getbit,
    getChunksize: function(){
      return chunksize;
    },
    getChunks: function(){
      return chunks;
    },
    progress: function(){
      return popcount() / chunks;
    },
    downloadContiguousChunks: downloadContiguousChunks,
    readChunk: readChunk,
    reset: reset
  };
}


var can_download = true;
var concurrencyKey = +new Date;
var downloading = false;

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


function indexsize(){
  return 7924566;
}
function dumpsize(){
  return 1025405491;
}
function indexurl(ptr){
  return ['/Downloads/split2/pi.index', ptr];
}
function dumpurl(ptr){
  var CHUNK_SIZE = 100000000;
  return ['/Downloads/split2/splitpi/pi_' +
  'aa,ab,ac,ad,ae,af,ag,ah,ai,aj,ak'.split(',')[Math.floor(ptr / CHUNK_SIZE)],
    ptr % CHUNK_SIZE];
}

var index = VirtualFile('test_index', indexsize(), 1024 * 4, indexurl); //4KiB chunk size
var dump = VirtualFile('test_dump', dumpsize(), 1024 * 500, dumpurl); //500KB chunk size (note, that it has to be a multiple of the underlying file subdivision size


var index_progress = 0, dump_progress = 0;
function beginDownload(){
  updateProgress();
  downloadDump();
  downloadIndex();
}


function updateProgress(){
  var progress = (dump.progress() * dumpsize() + index.progress() * indexsize())/(dumpsize() + indexsize());
  if(progress != 1){
    updatePreview();
	  document.getElementById('download').style.display = '';
  	document.getElementById('progress').value = progress;
  	document.getElementById('download').title = (100 * progress).toFixed(5)+"%";
		document.getElementById('status').innerHTML = '<b>Downloading</b> <a href="?'+lastPreview.title+'">'+lastPreview.title+'</a>';
	}else{
  	document.getElementById('download').style.display = 'none';
	}
}

var lastPreview = {chunk: -999, entries: [], title: '', lastTime: 0};
function updatePreview(){
  var chunk = dump.progress() * index.getChunks() * 0.92195; //0.92195 is the sqrt(.85), and I won't tell you how it's significant
  var shiftconst = Math.pow(3.16, 2);
  
  if(chunk - lastPreview.chunk > shiftconst){
    index.readChunkText(Math.floor(chunk), function(e){
      lastPreview.entries = e.split('\n').slice(1, -1).map(function(e){return e.split(/>|\|/)[0]});
      lastPreview.chunk = Math.floor(chunk);
      updateProgress();
    })
  }else{
    if(new Date - lastPreview.lastTime > 1337){
      lastPreview.title = lastPreview.entries[Math.floor(lastPreview.entries.length * (chunk - lastPreview.chunk) / shiftconst)] || '';
      lastPreview.lastTime = +new Date;
    }
  }
}

function downloadDump(){
  while(dump.checkChunk(dump_progress)) dump_progress++;
  if(dump_progress >= dump.getChunks()) return;
  dump.downloadContiguousChunks(dump_progress, Math.floor((1024 * 1024 * 4)/ dump.getChunksize()), function(){
    updateProgress();
    setTimeout(downloadDump, 1000);
  });
}

var lastTitleChange = 0;

function downloadIndex(){
  while(index.checkChunk(index_progress)) index_progress++;
  if(index_progress >= index.getChunks()) return;
  //index.readChunk(index_progress, function(){
  
  index.downloadContiguousChunks(index_progress, Math.floor((1024 * 1024 * 2)/ index.getChunksize()), function(e){
    updateProgress();
    setTimeout(downloadIndex, 1000);
  })
  //});
}

setTimeout(updateProgress, 10);
setTimeout(beginDownload, 1337);

function nero(){
  index.reset();
  dump.reset();
}
