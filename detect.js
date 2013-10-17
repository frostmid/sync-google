function (url, callback) {
	
  	if (! url.match(/www.youtube.com\/(.+)/)) return;
  
  	callback (url);


  	if (url.match (/youtube.com\/(channel|user)\/(.+)\/discussion/) { //getDiscussion
		return ['urn:fos:sync:feature/11111111111111'];
  	} else if (url.match (/youtube.com\/(channel|user)/) { //getChannel

  	}



  
  	if (url.match (/youtube.com\/(channel|user)\/(.+)/)) {
  		return ['urn:fos:sync:feature/dfe416e02c0611e390a6ad90b2a1a278'];
  	} else if (url.match (/youtube.com\/user\/(.+)\/videos/) || ) {
  		return ['urn:fos:sync:feature/b300d9102c0611e390a6ad90b2a1a278'];
  	} else if (url.match (/youtube.com\/user\/(.+)/)) {
  		return ['urn:fos:sync:feature/097c96802c0711e390a6ad90b2a1a278'];
  	} else if (url.match (/youtube.com\/user\/(.+)/)) {

  	}
};



/*
urn:fos:sync:feature/dfe416e02c0611e390a6ad90b2a1a278   getUploadedVideos
urn:fos:sync:feature/1f7b48b036c411e3b620d1a9472cd3f6   getLikedVideos
urn:fos:sync:feature/583fe84036c411e3b620d1a9472cd3f6   getPlaylistVideos
urn:fos:sync:feature/b300d9102c0611e390a6ad90b2a1a278   getVideo
urn:fos:sync:feature/eeb318202c0511e390a6ad90b2a1a278   resolveToken
urn:fos:sync:feature/11b6b7a02c0611e390a6ad90b2a1a278   reply
urn:fos:sync:feature/9ad4c1e02c0511e390a6ad90b2a1a278   explain



*/