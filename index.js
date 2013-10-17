process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var	_ = require ('lodash'),
	Promises = require ('vow'),
	SocketIO = require ('socket.io-client'),
	Slave = require ('fos-sync-slave'),
	YouTube = require ('./libs/youtube'),
	url = process.argv [2] || 'http://127.0.0.1:8001';

//TODO: разделение youtube, google+ и пр.

var parse = {
	'youtube#channel': function (entry) {
		return {
			'url': 'https://www.youtube.com/channel/' + entry.id,
			'entry-type': 'urn:fos:sync:entry-type/69a597a02c0711e390a6ad90b2a1a278',
			'username': entry.snippet.title,
			'first-name': entry.snippet.title,
			'created_at': (new Date (entry.snippet.publishedAt)).getTime () / 1000,
			'avatar': entry.snippet.thumbnails.default.url,
			'alias': _.compact ([
				entry.contentDetails.googlePlusUserId ? 'https://plus.google.com/' + entry.contentDetails.googlePlusUserId : null
			]),
			'metrics': {
				'comments': entry.statistics.commentCount,
				'likes':  entry.statistics.subscriberCount
			},
			'show-url': 'https://www.youtube.com/channel/' + entry.snippet.title
		};
	},

	'youtube#playlist': function (entry) {
		return {
			'entry-type': 'urn:fos:sync:entry-type/8885476036c511e3b620d1a9472cd3f6',

		}
	},

	'youtube#user': function (entry) {
		return {
			'url': 'https://plus.google.com/' + entry.contentDetails.googlePlusUserId,
			'entry-type': 'urn:fos:sync:entry-type/6bbd8c902fb411e3bf276be78cff8242',
			'first-name': entry.snippet.title,
			'created_at': (new Date (entry.snippet.publishedAt)).getTime () / 1000,
			'avatar': entry.snippet.thumbnails.default.url
		};
	},

	'youtube#post': function (entry) {
		return {
			'url': normalizeURL (entry.url),
			'entry-type': 'urn:fos:sync:entry-type/62c4870f3c8a6aee0dd7e88e9e532848',
			'ancestor': entry.ancestor || null,
			'author': 'http://www.livejournal.com/users/' + entry.postername + '/profile',
			'title': entry.subject || null,
			'content': entry.event || null,
			'created_at': entry.event_timestamp,
			'metrics': {
				'comments': entry.reply_count || 0
			},
			'show-url': normalizeURL (entry.url, true)
		};
	},

	'youtube#comment': function (entry) {
		return {
			'url': normalizeURL (entry.url),
			'entry-type': 'urn:fos:sync:entry-type/62c4870f3c8a6aee0dd7e88e9e54463b',
			'ancestor': entry.ancestor || null,
			'author': 'http://www.livejournal.com/users/' + entry.postername + '/profile',
			'title': entry.subject || null,
			'content': entry.body || null,
			'created_at': entry.datepostunix,
			'metrics': {
				'comments': entry.reply_count || 0
			},
			'show-url': normalizeURL (entry.url, true)
		};
	},

	
};

function youtube (slave, task, preEmit) {
	return new YouTube ({
		accessToken: task._prefetch.token.access_token,
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
	title: 'youtube api',
	version: '0.0.1'
}))

	.use ('urn:fos:sync:feature/eeb318202c0511e390a6ad90b2a1a278', function resolveToken (task) {
		var token = task._prefetch.token;

		var preEmit = function (entry) {
			entry.tokens = [token._id];
			return entry;
		};

		return youtube (this, task, preEmit).getChannel ();
	})

	.use ('urn:fos:sync:feature/dfe416e02c0611e390a6ad90b2a1a278', function getChannel (task) {
		return youtube (this, task).getChannel (task.url);
	})

	.use ('urn:fos:sync:feature/b300d9102c0611e390a6ad90b2a1a278', function getVideo (task) {
		return youtube (this, task).getVideo (task.url);
	})

	.use ('urn:fos:sync:feature/097c96802c0711e390a6ad90b2a1a278', function getProfile (task) {
		return null;
	})

	.use ('urn:fos:sync:feature/11b6b7a02c0611e390a6ad90b2a1a278', function reply (task) {
		return youtube (this, task).reply (task.url, task.content, task.issue);
	})

	.use ('urn:fos:sync:feature/9ad4c1e02c0511e390a6ad90b2a1a278', function explain (task) {
		
		return null;
	})


	.fail (function (error) {
		console.error ('Error', error);

		var reconnect = _.bind (function () {
			this.connect (SocketIO, url)
		}, this);
		
		_.delay (reconnect, 1000);
	})

	.connect (SocketIO, url);


/*
urn:fos:sync:entry-type/4db0ea402c0711e390a6ad90b2a1a278 видеозапись
urn:fos:sync:entry-type/69a597a02c0711e390a6ad90b2a1a278 канал
urn:fos:sync:entry-type/b0a3e0d02c0711e390a6ad90b2a1a278 комментарий

*/