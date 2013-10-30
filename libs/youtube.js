var	_ = require ('lodash'),
	Promises = require ('vow'),
	rateLimit = require ('fun-rate-limit'),
	querystring = require ('querystring'),
	request = rateLimit.promise (require ('fos-request'), 200),
	xml2js = require('xml2js'),
	Url = require ('url');


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
		developerKey: null,
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

				if (!response.match (/<?xml/)) {
					throw new Error (response + '. Url: ' + url);
				}

				xmlParser.parseString (response, function (error, result) {
					if (error) {
						throw new Error ('Error XMLparsing after request url ' + url);
					}

					if (result.errors) {
						var error_code = result.errors.error.code,
							error_message = result.errors.error.internalReason;

						throw new Error ('Request return error ' + error_code + ': ' + error_message + ' for url ' + url);
					}

					return promise.fulfill (result);
				});

				return promise;
			})
	},

	getChannel: function (url, onlyObject) {
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
					throw new Error ('Channel was not found for url ' + url);
				}

				var entry = response.items [0];

				if (onlyObject) {
					return entry;
				} else {
					return self.entry (entry);
				}
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
						throw new Error ('Channel was not found for url ' + url);
					}

					promise.fulfill (response.items [0].id);
				});
		}

		return promise;
	},

	getPlaylistVideos: function (playlistId, authorId) {
		var self = this,
			params = {
				part: 'snippet',
				playlistId: playlistId
			};

		return self.list ('/playlistItems', params, function (entry) {
			entry.author = authorId || null;

			return Promises.all ([
				self.entry (entry),
				self.getComments (entry)
			]);
		});
	},

	getPlaylistVideosByURL: function (url) {
		var self = this,
			tmp = url.match (/(?:\?|\&)list=(.+)/),
			playlistId = tmp ? tmp [1] .replace (/\&(.+)/, '') : null;

		return self.getChannel (url, true)
			.then (function (channel) {
				var authorId = channel.contentDetails.googlePlusUserId;

				return self.getPlaylistVideos (playlistId, authorId);
			});
	},

	getUploadedVideos: function (url) {
		var self = this;

		return self.getChannel (url, true)
			.then (function (channel) {
				var playlistId = channel.contentDetails.relatedPlaylists.uploads,
					authorId = channel.contentDetails.googlePlusUserId;

				return self.getPlaylistVideos (playlistId, authorId);
			});
	},

	getLikedVideos: function (url) {
		var self = this;

		return self.getChannel (url, true)
			.then (function (channel) {
				var playlistId = channel.contentDetails.relatedPlaylists.likes,
					authorId = channel.contentDetails.googlePlusUserId;

				return self.getPlaylistVideos (playlistId, authorId);
			});
	},

	getPlaylistedVideos: function (url) {
		var self = this;

		return self.getChannel (url, true)
			.then (function (channel) {
				var params = {part: 'snippet', channelId: channel.id};

				return self.list ('/playlists', params, function (playlist) {
					var authorId = channel.contentDetails.googlePlusUserId;

					return self.getPlaylistVideos (playlist.id, authorId);
				});
			});
	},

	getComments: function (entry) {
		var self = this,
			objectId = entry.id;

		if (entry.kind == 'youtube#playlistItem') {
			objectId = entry.snippet.resourceId.videoId;
		}

		return self.listXML ('/feeds/api/videos/' + objectId + '/comments', function (item) {
			return self._parseComment (item)
				.then (function (comment) {
					return self.entry (comment, 'youtube#comment');
				});
		});
	},

	_parseComment: function (item) {
		var self = this;

		return self.getXML (item.author.uri)
			.then (function (author) {
				item.googlePlusUserId = author.entry ['yt:googlePlusUserId'];

				_.each (item.link, function (link) {
					if (link.$.rel != 'http://gdata.youtube.com/schemas/2007#in-reply-to') return;
					
					item.ancestor = link.$.href;
				});

				if (!item.googlePlusUserId) {
					return self.get ('/channels', {part: 'contentDetails', forUsername: author.entry ['yt:username']})
						.then (function (result) {
							var channel = result.items [0];

							item.channelId = channel.id;

							return item;
						});
				}

				return item;
			});
	},

	getVideo: function (url, onlyObject) {
		var self = this,
			tmp = url.match (/\?v=(.+)/),
			objectId = tmp ? tmp [1] .replace (/\&(.+)/, '') : null;

		return self.get ('/videos', {part: 'snippet', id: objectId})
			.then (function (response) {
				var entry = response.items [0];

				return self.get ('/channels', {part: 'contentDetails', id: entry.snippet.channelId})
					.then (function (channel) {
						entry.author = channel.contentDetails ? channel.contentDetails.googlePlusUserId || null : null;

						if (onlyObject) {
							return entry;
						} else {
							return Promises.all ([
								self.entry (entry),
								self.getComments (entry)
							]);
						}
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

			console.log ('* emit', parsed.url);
			
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

			if (result.feed.entry) {
				var itemsList = (typeof result.feed.entry == 'object') ? result.feed.entry : [result.feed.entry];

				promises = _.map (
					_.filter (itemsList, function (entry) {
						var created_time = entry.published ? ((new Date (entry.published)).getTime ()) : null;

						return (created_time && scrapeStart && (created_time >= scrapeStart));
					}),
					iterator
				);
			}

			_.each (result.feed.link, function (entry) {
				if (entry.$.rel != 'next') return;
				
				promises.push (
					fetchMore (entry.$.href)
				);
			});

			return Promises.all (promises);
		};

		return this.getXML (endpoint, {'max-results': 50})
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
			videoId, commentId, tmp;

		if (tmp = url.match (/\/feeds\/api\/videos\/(.+)\/comments\/(.+)/)) {
			videoId = tmp [1];
			commentId = tmp [2];
		} else if (tmp = url.match (/\/watch\?v=(.+)/)) {
			videoId = tmp [1];
		}

		var headers = {
			'Authorization': 'OAuth ' + self.settings.accessToken,
			'X-GData-Key': 'key=' + self.settings.developerKey,
			'Content-Type': 'application/atom+xml'
		};

		var body = '<?xml version="1.0" encoding="UTF-8"?>' +
			'<entry xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://gdata.youtube.com/schemas/2007">' +
				(commentId ? '<link rel="http://gdata.youtube.com/schemas/2007#in-reply-to" type="application/atom+xml" href="https://gdata.youtube.com/feeds/api/videos/' + videoId + '/comments/' + commentId + '"/>' : '') +
				'<content>' + message + '</content>' +
			'</entry>';

		var url = self.settings.oldBase + '/feeds/api/videos/' + videoId + '/comments?alt=atom&v=2';

		return self.request ({url: url, headers: headers, body: body, method: 'post'})
			.then(function (result) {
				if (tmp = result.match (/<id>tag\:youtube\.com\,(?:\d+)\:video\:(?:.+)\:comment\:(.+)<\/id>/)) {
					var promise = Promises.promise(),
						commentId = tmp [1],
						commentUrl = self.settings.oldBase + '/feeds/api/videos/' + videoId + '/comments/' + commentId;
					
					// youtube needs some seconds for processing
					setTimeout (function () {
						return self.getXML (commentUrl)
							.then (function (item) {
								return self._parseComment (item.entry)
									.then (function (entry) {
										entry.issue = issue;
										promise.fulfill (entry);
									});
							});
					}, 3000);

					return promise;
				} else {
					throw new Error ('Message was not send');
				}
			})
			.then (function (entry) {
				return self.entry (entry, 'youtube#comment');
			});
	},

	search: function (url) {
		var self = this,
			query = Url.parse (url, true).query,
			params = {
				part: 'snippet',
				q: query.search_query || null
			};

		return self.list ('/search', params, function (entry) {
			if (entry.id.kind == 'youtube#channel') {
				return self.getChannel ('/channel/' + entry.id.channelId);
			} else if (entry.id.kind == 'youtube#video') {
				return self.getVideo ('/watch?v=' + entry.id.videoId);
			} else if (entry.id.kind == 'youtube#playlist') {
				return self.getChannel ('/channel/' + entry.snippet.channelId, true)
					.then (function (channel) {
						var authorId = channel.contentDetails.googlePlusUserId;
						return self.getPlaylistVideos (entry.id.playlistId, authorId);
					});
			} else {
				throw new Error ('Entry type is unknown ' + entry.id.kind);
			}
		});
	},

	// explain methods:
	explainChannel: function (url) {
		var self = this;

		return self.getChannel (url, true)
			.then (function (entry) {
				return self.entry (entry);
			});
	},

	explainVideo: function (url) {
		var self = this;

		return self.getVideo (url, true)
			.then (function (entry) {
				return self.entry (entry);
			});
	},

	explainComment: function (url) {
		var self = this;

		return self.getXML (url)
			.then (function (item) {
				return self._parseComment (item.entry)
					.then (function (comment) {
						return self.entry (comment, 'youtube#comment');
					});
			});
	}
});