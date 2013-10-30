process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var	_ = require ('lodash'),
	Promises = require ('vow'),
	SocketIO = require ('socket.io-client'),
	Slave = require ('fos-sync-slave'),
	YouTube = require ('./libs/youtube'),
	GooglePlus = require ('./libs/googleplus'),
	url = process.argv [2] || 'http://127.0.0.1:8001';


//TODO: разделение youtube, plus и пр.
var parse = {
	'plus#person': function (entry) {
		switch (entry.objectType) {
			case 'person':
				return {
					'url': 'https://plus.google.com/' + entry.id,
					'entry-type': 'urn:fos:sync:entry-type/6bbd8c902fb411e3bf276be78cff8242',
					'first-name': entry.name.givenName,
					'family-name': entry.name.familyName, 
					'avatar': entry.image ? entry.image.url : null,
					'gender': entry.gender ? 'urn:gender/' + entry.gender : null,
					'show-url': entry.url || null
				};

			case 'page':
				return {
					'url': 'https://plus.google.com/' + entry.id,
					'entry-type': 'urn:fos:sync:entry-type/6bbd8c902fb411e3bf276be78cff8242', //TODO: change
					'first-name': entry.displayName,
					'avatar': entry.image ? entry.image.url : null,
					'content': entry.aboutMe || null,
					'show-url': entry.url || null
				};

			default: throw new Error ('Error implement for object type ' + entry.objectType);
		}
	},

	'youtube#channel': function (entry) {
		return {
			'url': 'https://www.youtube.com/channel/' + entry.id,
			'entry-type': 'urn:fos:sync:entry-type/69a597a02c0711e390a6ad90b2a1a278',
			'title': entry.snippet.title,
			'username': entry.snippet.title,
			'first-name': entry.snippet.title,
			'created_at': (new Date (entry.snippet.publishedAt)).getTime () / 1000,
			'avatar': entry.snippet.thumbnails.default.url,
			'content': entry.snippet.description || null,
			'alias': _.compact ([
				entry.contentDetails.googlePlusUserId ? 'https://plus.google.com/' + entry.contentDetails.googlePlusUserId : null
			]),
			'metrics': {
				'comments': entry.statistics.commentCount,
				'likes':  entry.statistics.subscriberCount
			}
		};
	},

	'youtube#playlist': function (entry) {
		return {
			'entry-type': 'urn:fos:sync:entry-type/8885476036c511e3b620d1a9472cd3f6',

		}
	},

	'youtube#playlistItem': function (entry) {
		var url = 'https://www.youtube.com/watch?v=' + entry.snippet.resourceId.videoId;

		return {
			'url': url,
			'entry-type': 'urn:fos:sync:entry-type/4db0ea402c0711e390a6ad90b2a1a278',
			'ancestor': 'https://www.youtube.com/channel/' + entry.snippet.channelId,
			'author': entry.author ? 'https://plus.google.com/' + entry.author : (entry.snippet.channelId ? 'https://www.youtube.com/channel/' + entry.snippet.channelId : null),
			'title': entry.snippet.title || null,
			'content': entry.snippet.description || null,
			'created_at': (new Date (entry.snippet.publishedAt)).getTime () / 1000,
			'show-url': url + '&list=' + entry.snippet.playlistId
		};
	},

	'youtube#video': function (entry) {
		return {
			'url': 'https://www.youtube.com/watch?v=' + entry.id,
			'entry-type': 'urn:fos:sync:entry-type/4db0ea402c0711e390a6ad90b2a1a278',
			'ancestor': 'https://www.youtube.com/channel/' + entry.snippet.channelId,
			'author': entry.author ? 'https://plus.google.com/' + entry.author : (entry.snippet.channelId ? 'https://www.youtube.com/channel/' + entry.snippet.channelId : null),
			'title': entry.snippet.title || null,
			'content': entry.snippet.description || null,
			'created_at': (new Date (entry.snippet.publishedAt)).getTime () / 1000
		};
	},

	'youtube#comment': function (entry) {
		return {
			'url': entry.id,
			'entry-type': 'urn:fos:sync:entry-type/b0a3e0d02c0711e390a6ad90b2a1a278',
			'ancestor': entry.ancestor ? entry.ancestor : 'https://www.youtube.com/watch?v=' + entry ['yt:videoid'],
			'author': entry.googlePlusUserId ? 'https://plus.google.com/' + entry.googlePlusUserId : (entry.channelId ? 'https://www.youtube.com/channel/' + entry.channelId : null),
			'title': entry.title._,
			'content': entry.content._,
			'created_at': (new Date (entry.published)).getTime () / 1000,
			'show-url': 'https://www.youtube.com/comment?lc=' + entry.id.match (/\/comments\/(.+)/) [1] + '#comments-view'
		};
	},

	
};

function youtube (slave, task, preEmit) {
	return new YouTube ({
		accessToken: task._prefetch.token.access_token,
		developerKey: task._prefetch.bridge.developer_key,
		emit: function (entry) {
			if (preEmit) {
				entry = preEmit (entry);
			}

			return slave.emitter (task).call (this, entry);
		},
		scrapeStart: task['scrape-start'],
		parse: parse
	})
};

function googleplus (slave, task, preEmit) {
	return new GooglePlus ({
		accessToken: task._prefetch.token.access_token,
		developerKey: task._prefetch.bridge.developer_key,
		emit: function (entry) {
			if (preEmit) {
				entry = preEmit (entry);
			}

			return slave.emitter (task).call (this, entry);
		},
		scrapeStart: task['scrape-start'],
		parse: parse
	})
};

(new Slave ({
	title: 'google api',
	version: '0.1.4'
}))

	//Google+
	.use ('urn:fos:sync:feature/097c96802c0711e390a6ad90b2a1a278', function getProfile (task) {
		return googleplus (this, task).getProfile (task.url);
	})


	//YouTube
	.use ('urn:fos:sync:feature/dfe416e02c0611e390a6ad90b2a1a278', function getUploadedVideos (task) {
		return youtube (this, task).getUploadedVideos (task.url);
	})

	.use ('urn:fos:sync:feature/1f7b48b036c411e3b620d1a9472cd3f6', function getLikedVideos (task) {
		return youtube (this, task).getLikedVideos (task.url);
	})

	.use ('urn:fos:sync:feature/583fe84036c411e3b620d1a9472cd3f6', function getPlaylistedVideos (task) {
		return youtube (this, task).getPlaylistedVideos (task.url);
	})

	.use ('urn:fos:sync:feature/0578fe0036db11e3b620d1a9472cd3f6', function getPlaylistVideosByURL (task) {
		return youtube (this, task).getPlaylistVideosByURL (task.url);
	})

	.use ('urn:fos:sync:feature/2a8baec036d811e3b620d1a9472cd3f6', function search (task) {
		return youtube (this, task).search (task.url);
	})

	.use ('urn:fos:sync:feature/b300d9102c0611e390a6ad90b2a1a278', function getVideo (task) {
		return youtube (this, task).getVideo (task.url);
	})

	.use ('urn:fos:sync:feature/11b6b7a02c0611e390a6ad90b2a1a278', function reply (task) {
		return youtube (this, task).reply (task.url, task.content, task.issue);
	})


	//Common
	.use ('urn:fos:sync:feature/eeb318202c0511e390a6ad90b2a1a278', function resolveToken (task) {
		var token = task._prefetch.token;

		var preEmit = function (entry) {
			entry.tokens = [token._id];

			return entry;
		};

		return googleplus (this, task, preEmit).getProfile ();
	})

	.use ('urn:fos:sync:feature/9ad4c1e02c0511e390a6ad90b2a1a278', function explain (task) {
		
		if (task.url.match (/plus\.google\.com\/(\d+)/)) {	// getProfile
			return googleplus (this, task).getProfile (task.url);
		} else if (task.url.match (/www\.youtube\.com\/(channel|user)\/(.+)/)) {	//getChannel
			return youtube (this, task).explainChannel (task.url);
		} else if (task.url.match (/\/watch\?v=(.+)/)) {
			return youtube (this, task).explainVideo (task.url);
		} else if (task.url.match (/\/feeds\/api\/videos\/(.+)\/comments\//)) {
			return youtube (this, task).explainComment (task.url);
		} else {
			throw new Error ('Explain not implement for ' + task.url);
		}
	})


	.fail (function (error) {
		console.error ('Error', error);

		var reconnect = _.bind (function () {
			this.connect (SocketIO, url)
		}, this);
		
		_.delay (reconnect, 1000);
	})

	.connect (SocketIO, url);