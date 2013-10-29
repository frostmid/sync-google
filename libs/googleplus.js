var	_ = require ('lodash'),
	Promises = require ('vow'),
	rateLimit = require ('fun-rate-limit'),
	querystring = require ('querystring'),
	request = rateLimit.promise (require ('fos-request'), 200);


module.exports = function GooglePlus (settings) {
	this.settings = _.extend ({}, this.settings, settings);
	this.entry = _.bind (this.entry, this);
};

_.extend (module.exports.prototype, {
	settings: {
		base: 'https://www.googleapis.com/plus/v1',
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

	getProfile: function (url) {
		var self = this,
			tmp = url ? url.match(/\/((?:\d+){10})/) : null,
			userId = tmp ? tmp [1] : 'me',
			params = {};

		return this.get ('/people/' + userId, params)
			.then (function (entry) {
				return self.entry (entry);
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
	}
});