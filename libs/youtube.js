var	_ = require ('lodash'),
	Promises = require ('vow'),
	rateLimit = require ('fun-rate-limit'),
	querystring = require ('querystring'),
	request = rateLimit.promise (require ('fos-request'), 200),
	xml2js = require('xml2js');


module.exports = function YouTube (settings) {
	this.settings = _.extend ({}, this.settings, settings);
	this.entry = _.bind (this.entry, this);
};

_.extend (module.exports.prototype, {
	settings: {
		base: 'https://www.googleapis.com/youtube/v3',
		oldBase: 'http://gdata.youtube.com',
		locale: 'ru_RU',
		accessToken: null,
		emit: null,
		scrapeStart: null
	},

	request: function (url, params) {
		if (!url) {
			throw new Error ('None url for request');
		}

		if (params) {
			url += ((url.indexOf ('?') === -1) ? '?' : '&') + querystring.stringify(params);
		}

		return request (url)
			.then (function (response) {
				if (response.error) {
					var error_code = response.error.code,
						error_message = response.error.message;
						
					throw new Error ('Request return error ' + error_code + ': ' + error_message + ' for url ' + url);
				}

				return response;
			});
	},

	get: function (endpoint, params) {
		var url = this.settings.base + endpoint,
			params = params ? params : {};

		params.access_token = this.settings.accessToken;

		return this.request (url, params);
	},

	getXML: function (endpoint, params) {
		var url = ((endpoint.indexOf ('http') === -1) ? this.settings.oldBase : '') + endpoint;

		return this.request (url, params)
			.then (function (response) {
				var promise = Promises.promise(),
					xmlParser = new xml2js.Parser({
						//ignoreAttrs: true,
						normalize: true,
						explicitArray: false
					});

				xmlParser.parseString (response, function (error, result) {
					if (error) {
						return promise.reject (error);
					}

					return promise.fulfill (result);
				});

				return promise;
			})
	},

	getChannel: function (url, sendToEmit) {
		var self = this,
			tmp = url.match(/\/(channel|user)\/(.+)/),
			type = tmp ? tmp [1] : null,
			objectId = tmp ? tmp [2] .replace(/\/(.+)/, '') : null,
			params = {};

		params.part = 'snippet,contentDetails,statistics';

		if (type == 'channel') {
			params.id = objectId;
		} else {
			params.forUsername = objectId;
		}

		return self.get ('/channels', params)
			.then(function (response) {
				if (!response.items || !response.items.length) {
					throw new Error ('Channel was not found');
				}

				var entry = response.items [0];

				if (sendToEmit) {
					return self.entry (entry);
				}

				return entry;
			})
	},

	_getChannelId: function (url) {
		var promise = Promises.promise();
			tmp = url.match(/\/(channel|user)\/(.+)/),
			type = tmp ? tmp [1] : null,
			objectId = tmp ? tmp [2] .replace(/\/(.+)/, '') : null;

		if (type == 'channel') {
			promise.fulfill (objectId);
		} else {
			this.get ('/channels', {forUsername: objectId, part: 'id'})
				.then(function (response) {
					if (!entry.items || !entry.items.length) {
						throw new Error ('Channel was not found');
					}

					promise.fulfill (response.items [0].id);
				});
		}

		return promise;
	},

	_getPlaylistVideos: function (playlistId, authorId) {
		var self = this,
			params = {
				part: 'snippet',
				playlistId: playlistId
			};

		return self.list ('/playlistItems', params, function (entry) {
			entry.author = authorId;

			return Promises.all ([
				self.entry (entry),
				self.getComments (entry)
			]);
		});
	},

	getUploadedVideos: function (url) {
		var self = this;

		return self.getChannel (url)
			.then (function (channel) {
				var playlistId = channel.contentDetails.relatedPlaylists.uploads,
					authorId = channel.contentDetails.googlePlusUserId;

				return self._getPlaylistVideos (playlistId, authorId);
			});
	},

	getLikedVideos: function (url) {
		var self = this;

		return self.getChannel (url)
			.then (function (channel) {
				var playlistId = channel.contentDetails.relatedPlaylists.likes,
					authorId = channel.contentDetails.googlePlusUserId;

				return self._getPlaylistVideos (playlistId, authorId);
			});
	},

	getPlaylistedVideos: function (url) {
		var self = this;

		return self.getChannel (url)
			.then (function (channel) {
				var params = {part: 'snippet', channelId: channel.id};

				return self.list ('/playlists', params, function (playlist) {
					var authorId = channel.contentDetails.googlePlusUserId;

					return self._getPlaylistVideos (playlist.id, authorId);
				});
			});
	},

	getPlaylistVideos: function (url) {
		var self = this,
			tmp = url.match (/(?:\?|\&)list=(.+)/),
			playlistId = tmp ? tmp [1] .replace (/\&(.+)/, '') : null;

		return self.getChannel (url)
			.then (function (channel) {
				var authorId = channel.contentDetails.googlePlusUserId;

				return self._getPlaylistVideos (playlistId, authorId);
			});
	},


	getComments: function (entry) {
		var self = this,
			endpoint = '/feeds/api/videos/' + entry.id + '/comments';

		return self.listXML (endpoint, function (item) {
			return self.getXML (item.author.uri)
				.then (function (author) {
					item.googlePlusUserId = author.entry ['yt:googlePlusUserId'];

					if (!item.googlePlusUserId) {
						return self.get ('/channels', {part: 'contentDetails', forUsername: author.entry ['yt:username']})
							.then (function (result) {
								var channel = result.items [0];

								item.channelId = channel.id;

								return self.entry (item, 'youtube#comment');
							});
					}

					return self.entry (item, 'youtube#comment');
				});
		});
	},

	searchVideos: function (url) {
		return null;
	},

	getVideo: function (url) {
		var self = this,
			tmp = url.match (/\?v=(.+)/),
			objectId = tmp ? tmp [1] .replace (/\&(.+)/, '') : null;

		return self.get ('/videos', {part: 'snippet', id: objectId})
			.then (function (response) {
				var entry = response.items [0];

				return self.get ('/channels', {part: 'contentDetails', id: entry.snippet.channelId})
					.then (function (channel) {
						entry.author = channel.contentDetails ? channel.contentDetails.googlePlusUserId || null : null;

						return Promises.all ([
							self.entry (entry),
							self.getComments (entry)
						]);
					});
			});
	},
	

	entry: function (entry, type) {
		var type  = type ? type : (entry.kind ? entry.kind : null),
			parser = this.settings.parse [type],
			parsed;

		if (typeof parser == 'function') {
			try {
				parsed = parser.call (this, entry);
			} catch (e) {
				console.error ('Failed to parse entry', e.message, entry);
				throw e;
			}

			console.log('* emit', parsed.url);
			
			return Promises.when (parsed)
				.then (this.settings.emit);

		} else {
			console.log ('Skipping of unknown type', type);
		}
	},

	listXML: function (endpoint, iterator) {
		var scrapeStart = this.settings.scrapeStart;

		var fetchMore = _.bind (function (url) {
			return this.getXML (url)
				.then (process);
		}, this);

		var process = function (result) {
			var promises = [];

			// if (result.error) {
			// 	throw result.error;
			// }

			if (result.feed.entry) {
				promises = _.map (
					_.filter (result.feed.entry, function (entry) {
						var created_time = entry.published ? ((new Date (entry.published)).getTime ()) : null;

						return (created_time && scrapeStart && (created_time >= scrapeStart));
					}),
					iterator
				);
			}

			// TODO: uncomment for production
			// _.each (result.feed.link, function (entry) {
			// 	if (entry.$.rel != 'next') return;
				
			// 	promises.push (
			// 		fetchMore (entry.$.href)
			// 	);
			// });

			return Promises.all (promises);
		};

		return this.getXML (endpoint, {'max-results': 10})
			.then (process);
	},
	
	list: function (endpoint, params, iterator) {
		var self = this,
			params = params ? params : {};

		params.maxResults = 50;
		params.access_token = self.settings.accessToken;

		var fetchMore = _.bind (function (url, params) {
			return this.request (url, params)
				.then (process);
		}, this);

		var process = function (results) {
			var promises = [];

			if (results.error) {
				throw results.error;
			}

			if (results.items) {
				promises = _.map (
					_.filter (results.items, function (entry) {
						var created_time = (new Date (entry.snippet.publishedAt)).getTime (),
							scrapeStart = self.settings.scrapeStart;

						return (created_time && scrapeStart && (created_time >= scrapeStart));
					}),
					iterator
				);
			}

			if (results.nextPageToken) {
				params.pageToken = results.nextPageToken;

				promises.push (
					fetchMore (self.settings.base + endpoint, params)
				);
			}

			return Promises.all (promises);
		};

		return self.request (self.settings.base + endpoint, params)
			.then (process);
	},








	reply: function (url, message, issue) {
		var self = this,
			tmp = url.match(/\/users\/([A-Za-z_0-9-]+)\/(\d+).html(\?thread=(\d+))?/),
			params = {
				'journal': tmp [1],
				'ditemid': tmp [2],
				'parenttalkid': parseInt (tmp [4] / 256) || null,
				'replyto': tmp [4] || null,
				'body': message
			};

		return this.get ('addcomment', params)
			.then(_.bind(function (result) {
				if (result.message) {
					throw new Error (result.message);
				}
				
				if (result.status == 'OK') {
					var entry = {
						url: result.commentlink,
						ancestor: url,
						postername: this.settings.username,
						subject: '',
						body: message,
						datepostunix: parseInt(Date.now() / 1000),
						reply_count: 0,
						issue: issue
					};
					
					self.entry (entry, 'comment');
				} else {
					throw new Error ('Message was not send');
				}
			}, this));
	}
});