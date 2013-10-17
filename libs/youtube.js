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
		base: 'https://www.googleapis.com/youtube/v3',
		locale: 'ru_RU',
		accessToken: null,
		emit: null,
		scrapeStart: null
	},

	request: function (url) {
		if (!url) {
			throw new Error ('None url for request');
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

		return this.get ('/channels?part=id,snippet,statistics,contentDetails', params)
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