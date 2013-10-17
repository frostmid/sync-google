var	_ = require ('lodash'),
	Promises = require ('vow'),
	rateLimit = require ('fun-rate-limit'),
	querystring = require ('querystring'),
	request = rateLimit.promise (require ('fos-request'), 200);


module.exports = function YouTube (settings) {
	this.settings = _.extend ({}, this.settings, settings);
	this.entry = _.bind (this.entry, this);
};

_.extend (module.exports.prototype, {
	settings: {
		base: 'https://www.googleapis.com/',
		locale: 'ru_RU',
		accessToken: null,
		emit: null,
		scrapeStart: null
	},

	request: function (url) {
		if (!url) {
			throw new Error ('None url for request');
		}

		return request (url);
	},

	get: function (endpoint, params) {
		var url = this.settings.base + endpoint,
			params = params ? params : {};

		params.access_token = this.settings.accessToken;
		url += ((url.indexOf ('?') === -1) ? '?' : '&') + querystring.stringify(params);

		return this.request (url);
	},

	getChannel: function (channelId) {
		var self = this,
			params = {};

		/*
			id - for channelId
			forUsername - for username
			mine = true

			part = snippet,contentDetails

			contentDetails.relatedPlaylists.likes		//playlist id
			contentDetails.relatedPlaylists.uploads		//playlist id
			contentDetails.googlePlusUserId


		*/

		if (!channelId) {
			params.mine = true;
		} else {
			params.id = channelId;
		}

		return this.get ('/youtube/v3/channels?part=id,snippet,statistics,contentDetails', params)
			.then (function (entry) {
				if (!entry.items || !entry.items.length) {
					throw new Error ('No channels was found');
				}

				return Promises.when(
					self.entry (entry.items [0])
				);
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
				.then (this.settings.emit)
				.fail (function (error) {
					console.log ('Failed to emit entry', error, entry);
				})
				.done ();
		} else {
			console.log ('Skipping of unknown type', type);
		}
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
	},

	getProfile: function (url) {
		var self = this,
			tmp = url.match(/\/users\/([A-Za-z_0-9-]+)\/profile$/);

		return request ({url: 'http://' + tmp [1] + '.livejournal.com/profile'})
			.then (function (body) {
				var $ = cheerio.load (body),
					$user_info = $ ('dl.b-profile-userinfo').first();

				return {
					'username': tmp [1],
					'fullname':$user_info.find('dt:contains("Имя:") +').text() || $ ('h1.b-details-journal-title').text(),
					'avatar': $ ('.b-profile-userpic img').attr('src'),
					'nickname': $ ('.b-details-journal-ljuser .i-ljuser-username').text(),
					'city':$user_info.find('.locality').text() || null,
					'site':$user_info.find('dt:contains("Сайт:") +').find('a').attr('href') || null,
					'alias': _.compact ([
						$user_info.find('.b-contacts-mail').text() || null,
						$user_info.find('.b-contacts-facebook').text() || null,
						$user_info.find('.b-contacts-twitter').text() || null,
						$user_info.find('.b-contacts-vk').text() || null,
						$user_info.find('.b-contacts-ljtalk').text() || null,
						$user_info.find('.b-contacts-icq').text() || null,
						$user_info.find('.b-contacts-google').text() || null,
						$user_info.find('.b-contacts-skype').text() || null
					]);

					//'birth-date':$user_info.find('dt:contains("Дата рождения:") +').text() ||, //TODO: date parse
				};
			})
			.then (function (entry) {
				return Promises.when (self.entry (entry, 'profile'));
			});
	},

	getComment: function (url) {
		var self = this,
			tmp = url.match(/\/users\/([A-Za-z_0-9-]+)\/(\d+).html\?thread=(\d+)/);

		var params = {
			'journal': tmp [1],
			'ditemid': tmp [2],
			'dtalkid': tmp [3],
			'selecttype': 'one',
			'expand_strategy': 'mobile_thread',
			'page_size': 100
		};

		return this.get ('getcomments', params)
			.then(function (result) {
				if (result.message) {
					throw new Error (result.message);
				}

				if (!result.comments.length) {
					throw new Error ('Non exist comment ' + url);
				}

				var entry = result.comments [0];
				entry.children = null;
				entry.url = url;

				entry.ancestor = self.settings.base + '/users/' + tmp [1] + '/' + tmp [2] + '.html' +
					(entry.parentdtalkid ? '?thread=' + entry.parentdtalkid : '');

				return Promises.when (self.entry (entry, 'comment'));
			});			
	},

	getComments: function (parent) {
		var self = this,
			parentURL = this.normalizeURL (parent.url),
			tmp = parentURL.match(/\/users\/([A-Za-z_0-9-]+)\/(\d+).html$/),
			params = {
				'journal': tmp [1],
				'ditemid': tmp [2],
				'selecttype': null,
				'expand_strategy': 'mobile_thread',
				'page_size': 100
			};

		var flattenComment = function (entry, result) {
			if (!result) result = [];

			if (entry.children && entry.children.length) {
				entry.reply_count = entry.children.length;

				_.forEach (entry.children, _.bind(function (child) {
					child.ancestor = parentURL + '?thread=' + entry.dtalkid;
					result = flattenComment (child, result);
				}, this));
			}

			if (!entry.ancestor) 
				entry.ancestor = parentURL;

			entry.url = parentURL + '?thread=' + entry.dtalkid;
			entry.children = null;
			result.push (entry);

			return result;
		};

		return this.list ('getcomments', params, function (entry) {
			_.forEach (flattenComment (entry), function (item) {
				self.entry (item, 'comment');
			});
		});
	},

	getPost: function (url) {
		var tmp = url.match(/\/users\/([A-Za-z_0-9-]+)\/(\d+).html$/),
			params = {
				'journal': tmp [1],
				'ditemid': tmp [2],
				'selecttype': 'one'
			};

		return this.get ('getevents', params)
			.then(_.bind(function (result) {
				if (result.message) {
					throw new Error (result.message);
				}

				if (!result.events.length) {
					throw new Error ('Non exist post ' + url);
				}

				var entry = result.events [0];
				entry.postername = params.journal;

				return Promises.all ([
					this.entry (entry, 'post'),
					this.getComments (entry, 'comment')
				]);

			}, this));
	},

	getBlogPosts: function (url) {
		var tmp = url.match(/\/users\/([A-Za-z_0-9-]+)$/),
			params = {
				'journal': tmp [1],
				'lastsync': moment (this.settings.scrapeStart).format("YYYY-MM-DD HH:mm:ss"),
				'selecttype': 'lastn',
				'howmany': 50
			};

		return this.list ('getevents', params, _.bind(function (entry) {

			entry.postername = params.journal;

			return Promises.all ([
				this.entry (entry, 'post'),
				this.getComments (entry, 'comment')
			]);
		}, this));
	},

	list: function (method, params, iterator) {
		var self = this;

		var fetchMore = _.bind (function (method, params) {
			return this.xmlRPCRequest (method, params)
				.then (process);
		}, this);

		var process = function (results) {
			var promises = [];

			if (results.error) {
				throw results.error;
			}

			if (method == 'getcomments') {
				if (results.topitems) {
					promises = _.map (
						_.filter (results.comments, function (entry) {
							var created_time = entry.datepostunix || null,
								scrapeStart = self.settings.scrapeStart / 1000;

							return (created_time && scrapeStart && (created_time >= scrapeStart));
						}),
						iterator
					);
				}

				if (results.pages && (results.pages > results.page)) {
					params.page = params.page ? params.page + 1 : 2;

					promises.push (
						fetchMore (method, params)
					);
				}
			} else if (method == 'getevents') {
				if (results.events && results.events.length) {
					promises = _.map (
						_.filter (results.events, function (entry) {
							var created_time = entry.event_timestamp || null,
								scrapeStart = self.settings.scrapeStart / 1000;

							return (created_time && scrapeStart && (created_time >= scrapeStart));
						}),
						iterator
					);


					params.skip = params.skip ? params.skip + 50 : 50;

					promises.push (
						fetchMore (method, params)
					);
				}
			}

			return Promises.all (promises);
		};

		return this.get (method, params)
			.then (process);
	}
});