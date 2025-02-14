/*
 * Copyright (c) 2011, salesforce.com, inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided
 * that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list of conditions and the
 * following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and
 * the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * Neither the name of salesforce.com, inc. nor the names of its contributors may be used to endorse or
 * promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED
 * WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A
 * PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/* JavaScript library to wrap REST API on Visualforce. Leverages Ajax Proxy
 * (see http://bit.ly/sforce_ajax_proxy for details).
 *
 * Note that you must add the REST endpoint hostname for your instance (i.e.
 * https://na1.salesforce.com/ or similar) as a remote site - in the admin
 * console, go to Your Name | Setup | Security Controls | Remote Site Settings
 */

/*jslint browser: true*/
/*global alert, Blob, $, jQuery*/

var forcetk = window.forcetk;

if (forcetk === undefined) {
	forcetk = {};
}

if (forcetk.Client === undefined) {

	/**
	* The Client provides a convenient wrapper for the Force.com REST API,
	* allowing JavaScript in Visualforce pages to use the API via the Ajax
	* Proxy.
	* @param [clientId=null] 'Consumer Key' in the Remote Access app settings
	* @param [loginUrl='https://login.salesforce.com/'] Login endpoint
	* @param [proxyUrl=null] Proxy URL. Omit if running on Visualforce or
	*        PhoneGap etc
	* @constructor
	*/
	 forcetk.Client = function (clientId, loginUrl, proxyUrl) {
		'use strict';
		this.clientId = clientId;
		this.loginUrl = loginUrl || 'https://login.salesforce.com/';
		if (proxyUrl === undefined || proxyUrl === null) {
				if (location.protocol === 'file:' || location.protocol === 'ms-appx:') {
					// In PhoneGap
					this.proxyUrl = null;
				} else {
					// In Visualforce - still need proxyUrl for Apex REST methods
					this.proxyUrl = location.protocol + "//" + location.hostname
						+ "/services/proxy";
				}
				this.authzHeader = "Authorization";
		} else {
			// On a server outside VF
			this.proxyUrl = proxyUrl;
			this.authzHeader = "X-Authorization";
		}
		this.refreshToken = null;
		this.sessionId = null;
		this.apiVersion = null;
		this.visualforce = false;
		this.instanceUrl = null;
		this.asyncAjax = true;
	};

	/**
	* Set a refresh token in the client.
	* @param refreshToken an OAuth refresh token
	*/
	forcetk.Client.prototype.setRefreshToken = function (refreshToken) {
		'use strict';
		this.refreshToken = refreshToken;
	};

	/**
	* Refresh the access token.
	* @param callback function to call on success
	* @param error function to call on failure
	*/
	forcetk.Client.prototype.refreshAccessToken = function (callback, error) {
		'use strict';
		var that = this,
			url = this.loginUrl + '/services/oauth2/token';
		return jQuery.ajax({
				type: 'POST',
				url: (this.proxyUrl !== null && !this.visualforce) ? this.proxyUrl : url,
				cache: false,
				processData: false,
				data: 'grant_type=refresh_token&client_id=' + this.clientId + '&refresh_token=' + this.refreshToken,
				success: callback,
				error: error,
				dataType: "json",
				beforeSend: function (xhr) {
					if (that.proxyUrl !== null && !this.visualforce) {
						xhr.setRequestHeader('SalesforceProxy-Endpoint', url);
					}
				}
		});
	};

	/**
	* Set a session token and the associated metadata in the client.
	* @param sessionId a salesforce.com session ID. In a Visualforce page,
	*                use '{!$Api.sessionId}' to obtain a session ID.
	* @param [apiVersion="v31.0"] Force.com API version
	* @param [instanceUrl] Omit this if running on Visualforce; otherwise
	*                   use the value from the OAuth token.
	*/
	forcetk.Client.prototype.setSessionToken = function (sessionId, apiVersion, instanceUrl) {
		'use strict';
		this.sessionId = sessionId;
		this.apiVersion = (apiVersion === undefined || apiVersion === null)
				? 'v31.0' : apiVersion;
		if (instanceUrl === undefined || instanceUrl === null) {
				this.visualforce = true;

				// location.hostname can be of the form 'abc.na1.visual.force.com',
				// 'na1.salesforce.com' or 'abc.my.salesforce.com' (custom domains).
				// Split on '.', and take the [1] or [0] element as appropriate
				var elements = location.hostname.split("."),
					 instance = null;
				if (elements.length === 4 && elements[1] === 'my') {
					 instance = elements[0] + '.' + elements[1];
				} else if (elements.length === 3) {
					 instance = elements[0];
				} else {
					 instance = elements[1];
				}

				this.instanceUrl = "https://" + instance + ".salesforce.com";
		} else {
				this.instanceUrl = instanceUrl;
		}
	};

	/*
	* Low level utility function to call the Salesforce endpoint.
	* @param path resource path relative to /services/data
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	* @param [method="GET"] HTTP method for call
	* @param [payload=null] payload for POST/PATCH etc
	*/
	 forcetk.Client.prototype.ajax = function (path, callback, error, method, payload, retry, progressCallback) {
		'use strict';
		var that = this,
				url = (this.visualforce ? '' : this.instanceUrl) + '/services/data' + path;

		return jQuery.ajax({
				type: method || "GET",
				async: this.asyncAjax,
				url: (this.proxyUrl !== null && !this.visualforce) ? this.proxyUrl : url,
				contentType: method === "DELETE"  ? null : 'application/json',
				cache: false,
				processData: false,
				data: payload,
				success: callback,
				error: (!this.refreshToken || retry) ? error : function (jqXHR, textStatus, errorThrown) {
					if (jqXHR.status === 401) {
						that.refreshAccessToken(function (oauthResponse) {
								that.setSessionToken(oauthResponse.access_token, null,
									 oauthResponse.instance_url);
								that.ajax(path, callback, error, method, payload, true);
						},
								error);
					} else {
						error(jqXHR, textStatus, errorThrown);
					}
				},
				dataType: "json",
				beforeSend: function (xhr) {
					if (that.proxyUrl !== null && !that.visualforce) {
						xhr.setRequestHeader('SalesforceProxy-Endpoint', url);
					}
					xhr.setRequestHeader(that.authzHeader, "Bearer " + that.sessionId);
					xhr.setRequestHeader('X-User-Agent', 'salesforce-toolkit-rest-javascript/' + that.apiVersion);
					if(progressCallback){
						xhr.upload.addEventListener("progress", progressCallback);
					}
				}
		});
	};

	/**
	* Utility function to query the Chatter API and download a file
	* Note, raw XMLHttpRequest because JQuery mangles the arraybuffer
	* This should work on any browser that supports XMLHttpRequest 2 because arraybuffer is required.
	* For mobile, that means iOS >= 5 and Android >= Honeycomb
	* @author Tom Gersic
	* @param path resource path relative to /services/data
	* @param mimetype of the file
	* @param callback function to which response will be passed
	* @param [error=null] function to which request will be passed in case of error
	* @param retry true if we've already tried refresh token flow once
	*/
	 forcetk.Client.prototype.getChatterFile = function (path, mimeType, callback, error, retry) {
		'use strict';
		var that = this,
				url = (this.visualforce ? '' : this.instanceUrl) + path,
				request = new XMLHttpRequest();

		request.open("GET", (this.proxyUrl !== null && !this.visualforce) ? this.proxyUrl : url, true);
		request.responseType = "arraybuffer";

		request.setRequestHeader(this.authzHeader, "Bearer " + this.sessionId);
		request.setRequestHeader('X-User-Agent', 'salesforce-toolkit-rest-javascript/' + this.apiVersion);
		if (this.proxyUrl !== null && !this.visualforce) {
				request.setRequestHeader('SalesforceProxy-Endpoint', url);
		}

		request.onreadystatechange = function () {
				// continue if the process is completed
				if (request.readyState === 4) {
					// continue only if HTTP status is "OK"
					if (request.status === 200) {
						try {
								// retrieve the response
								callback(request.response);
						} catch (e) {
								// display error message
								alert("Error reading the response: " + e.toString());
						}
					} else if (request.status === 401 && !retry) {
						//refresh token in 401
						that.refreshAccessToken(function (oauthResponse) {
								that.setSessionToken(oauthResponse.access_token, null, oauthResponse.instance_url);
								that.getChatterFile(path, mimeType, callback, error, true);
						}, error);
					} else {
						// display status message
						error(request, request.statusText, request.response);
					}
				}
		};

		request.send();

	};

	// Local utility to create a random string for multipart boundary
	var randomString = function () {
		'use strict';
		var str = '',
				i;
		for (i = 0; i < 4; i += 1) {
				str += (Math.random().toString(16) + "000000000").substr(2, 8);
		}
		return str;
	};

	/* Low level function to create/update records with blob data
	* @param path resource path relative to /services/data
	* @param fields an object containing initial field names and values for
	*               the record, e.g. {ContentDocumentId: "069D00000000so2",
	*               PathOnClient: "Q1 Sales Brochure.pdf"}
	* @param filename filename for blob data; e.g. "Q1 Sales Brochure.pdf"
	* @param payloadField 'VersionData' for ContentVersion, 'Body' for Document
	* @param payload Blob, File, ArrayBuffer (Typed Array), or String payload
	* @param callback function to which response will be passed
	* @param [error=null] function to which response will be passed in case of error
	* @param retry true if we've already tried refresh token flow once
	*/
	forcetk.Client.prototype.blob = function (path, fields, filename, payloadField, payload, callback, error, retry, progressCallback) {
		'use strict';
		var that = this,
				url = (this.visualforce ? '' : this.instanceUrl) + '/services/data' + path,
				boundary = randomString(),
				blob = new Blob([
					 "--boundary_" + boundary + '\n'
						+ "Content-Disposition: form-data; name=\"entity_content\";" + "\n"
						+ "Content-Type: application/json" + "\n\n"
						+ JSON.stringify(fields)
						+ "\n\n"
						+ "--boundary_" + boundary + "\n"
						+ "Content-Type: application/octet-stream" + "\n"
						+ "Content-Disposition: form-data; name=\"" + payloadField
						+ "\"; filename=\"" + filename + "\"\n\n",
					payload,
					"\n"
						+ "--boundary_" + boundary + "--"
				], {type : 'multipart/form-data; boundary=\"boundary_' + boundary + '\"'}),
				request = new XMLHttpRequest();

		request.open("POST", (this.proxyUrl !== null && !this.visualforce) ? this.proxyUrl : url, this.asyncAjax);

		request.setRequestHeader('Accept', 'application/json');
		request.setRequestHeader(this.authzHeader, "Bearer " + this.sessionId);
		request.setRequestHeader('X-User-Agent', 'salesforce-toolkit-rest-javascript/' + this.apiVersion);
		request.setRequestHeader('Content-Type', 'multipart/form-data; boundary=\"boundary_' + boundary + '\"');
		if (this.proxyUrl !== null && !this.visualforce) {
				request.setRequestHeader('SalesforceProxy-Endpoint', url);
		}

		if (this.asyncAjax) {
				request.onreadystatechange = function () {
					// continue if the process is completed
					if (request.readyState === 4) {
						// continue only if HTTP status is good (1223)
						if ((request.status >= 200 && request.status < 300) || (request.status == 1223)) {
								// retrieve the response
								callback(request.response ? JSON.parse(request.response) : null);
						} else if (request.status === 401 && !retry) {
								that.refreshAccessToken(function (oauthResponse) {
									 that.setSessionToken(oauthResponse.access_token, null, oauthResponse.instance_url);
									 that.blob(path, fields, filename, payloadField, payload, callback, error, true);
								}, error);
						} else {
								// return status message
								error(request, request.statusText, request.response);
						}
					}
				};
		}
		if(progressCallback){
			request.upload.addEventListener("progress", progressCallback);
		}
		if(blob.fake) {
			request.send(blob.data);
		} else {
			request.send(blob);
		}


		return this.asyncAjax ? null : JSON.parse(request.response);
	};

	/*
	* Create a record with blob data
	* @param objtype object type; e.g. "ContentVersion"
	* @param fields an object containing initial field names and values for
	*               the record, e.g. {ContentDocumentId: "069D00000000so2",
	*               PathOnClient: "Q1 Sales Brochure.pdf"}
	* @param filename filename for blob data; e.g. "Q1 Sales Brochure.pdf"
	* @param payloadField 'VersionData' for ContentVersion, 'Body' for Document
	* @param payload Blob, File, ArrayBuffer (Typed Array), or String payload
	* @param callback function to which response will be passed
	* @param [error=null] function to which response will be passed in case of error
	* @param retry true if we've already tried refresh token flow once
	*/
	forcetk.Client.prototype.createBlob = function (objtype, fields, filename,
																	payloadField, payload, callback,
																	error, retry, progressCallback) {
		'use strict';
		return this.blob('/' + this.apiVersion + '/sobjects/' + objtype + '/',
								 fields, filename, payloadField, payload, callback, error, retry, progressCallback);
	};

	/*
	* Update a record with blob data
	* @param objtype object type; e.g. "ContentVersion"
	* @param id the record's object ID
	* @param fields an object containing initial field names and values for
	*               the record, e.g. {ContentDocumentId: "069D00000000so2",
	*               PathOnClient: "Q1 Sales Brochure.pdf"}
	* @param filename filename for blob data; e.g. "Q1 Sales Brochure.pdf"
	* @param payloadField 'VersionData' for ContentVersion, 'Body' for Document
	* @param payload Blob, File, ArrayBuffer (Typed Array), or String payload
	* @param callback function to which response will be passed
	* @param [error=null] function to which response will be passed in case of error
	* @param retry true if we've already tried refresh token flow once
	*/
	forcetk.Client.prototype.updateBlob = function (objtype, id, fields, filename,
																	payloadField, payload, callback,
																	error, retry) {
		'use strict';
		return this.blob('/' + this.apiVersion + '/sobjects/' + objtype + '/' + id +
								 '?_HttpMethod=PATCH', fields, filename, payloadField, payload, callback, error, retry);
	};

	/*
	* Low level utility function to call the Salesforce endpoint specific for Apex REST API.
	* @param path resource path relative to /services/apexrest
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	* @param [method="GET"] HTTP method for call
	* @param [payload=null] string or object with payload for POST/PATCH etc or params for GET
	* @param [paramMap={}] parameters to send as header values for POST/PATCH etc
	* @param [retry] specifies whether to retry on error
	*/
	forcetk.Client.prototype.apexrest = function (path, callback, error, method, payload, paramMap, retry) {
		'use strict';
		var that = this,
				url = this.instanceUrl + '/services/apexrest' + path;

		method = method || "GET";

		if (method === "GET") {
				// Handle proxied query params correctly
				if (this.proxyUrl && payload) {
					if (typeof payload !== 'string') {
						payload = jQuery.param(payload);
					}
					url += "?" + payload;
					payload = null;
				}
		} else {
				// Allow object payload for POST etc
				if (payload && typeof payload !== 'string') {
					payload = JSON.stringify(payload);
				}
		}

		return jQuery.ajax({
				type: method,
				async: this.asyncAjax,
				url: this.proxyUrl || url,
				contentType: 'application/json',
				cache: false,
				processData: false,
				data: payload,
				success: callback,
				error: (!this.refreshToken || retry) ? error : function (jqXHR, textStatus, errorThrown) {
					if (jqXHR.status === 401) {
						that.refreshAccessToken(function (oauthResponse) {
								that.setSessionToken(oauthResponse.access_token, null,
									 oauthResponse.instance_url);
								that.apexrest(path, callback, error, method, payload, paramMap, true);
						}, error);
					} else {
						  error(jqXHR, textStatus, errorThrown);
					}
				},
				dataType: "json",
				beforeSend: function (xhr) {
					var paramName;
					if (that.proxyUrl !== null) {
						xhr.setRequestHeader('SalesforceProxy-Endpoint', url);
					}
					//Add any custom headers
					if (paramMap === null) {
						paramMap = {};
					}
					for (paramName in paramMap) {
						if (paramMap.hasOwnProperty(paramName)) {
								xhr.setRequestHeader(paramName, paramMap[paramName]);
						}
					}
					xhr.setRequestHeader(that.authzHeader, "Bearer " + that.sessionId);
					xhr.setRequestHeader('X-User-Agent', 'salesforce-toolkit-rest-javascript/' + that.apiVersion);
				}
		});
	};

	/*
	* Lists summary information about each Salesforce.com version currently
	* available, including the version, label, and a link to each version's
	* root.
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.versions = function (callback, error) {
		'use strict';
		return this.ajax('/', callback, error);
	};

	/*
	* Lists available resources for the client's API version, including
	* resource name and URI.
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.resources = function (callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/', callback, error);
	};

	/*
	* Lists the available objects and their metadata for your organization's
	* data.
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.describeGlobal = function (callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/', callback, error);
	};

	/*
	* Describes the individual metadata for the specified object.
	* @param objtype object type; e.g. "Account"
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.metadata = function (objtype, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype + '/',
				callback, error);
	};

	/*
	* Completely describes the individual metadata at all levels for the
	* specified object.
	* @param objtype object type; e.g. "Account"
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.describe = function (objtype, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype
				+ '/describe/', callback, error);
	};

	/*
	* Creates a new record of the given type.
	* @param objtype object type; e.g. "Account"
	* @param fields an object containing initial field names and values for
	*               the record, e.g. {:Name "salesforce.com", :TickerSymbol
	*               "CRM"}
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.create = function (objtype, fields, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype + '/',
				callback, error, "POST", JSON.stringify(fields));
	};

	/*
	* Retrieves field values for a record of the given type.
	* @param objtype object type; e.g. "Account"
	* @param id the record's object ID
	* @param [fields=null] optional comma-separated list of fields for which
	*               to return values; e.g. Name,Industry,TickerSymbol
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	 forcetk.Client.prototype.retrieve = function (objtype, id, fieldlist, callback, error) {
		'use strict';
		if (arguments.length === 4) {
				error = callback;
				callback = fieldlist;
				fieldlist = null;
		}
		var fields = fieldlist ? '?fields=' + fieldlist : '';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype + '/' + id
				+ fields, callback, error);
	};

	/*
	* Upsert - creates or updates record of the given type, based on the
	* given external Id.
	* @param objtype object type; e.g. "Account"
	* @param externalIdField external ID field name; e.g. "accountMaster__c"
	* @param externalId the record's external ID value
	* @param fields an object containing field names and values for
	*               the record, e.g. {:Name "salesforce.com", :TickerSymbol
	*               "CRM"}
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	 forcetk.Client.prototype.upsert = function (objtype, externalIdField, externalId, fields, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype + '/' + externalIdField + '/' + externalId
				+ '?_HttpMethod=PATCH', callback, error, "POST", JSON.stringify(fields));
	};

	/*
	* Updates field values on a record of the given type.
	* @param objtype object type; e.g. "Account"
	* @param id the record's object ID
	* @param fields an object containing initial field names and values for
	*               the record, e.g. {:Name "salesforce.com", :TickerSymbol
	*               "CRM"}
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.update = function (objtype, id, fields, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype + '/' + id
				+ '?_HttpMethod=PATCH', callback, error, "POST", JSON.stringify(fields));
	};

	/*
	* Deletes a record of the given type. Unfortunately, 'delete' is a
	* reserved word in JavaScript.
	* @param objtype object type; e.g. "Account"
	* @param id the record's object ID
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.del = function (objtype, id, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/sobjects/' + objtype + '/' + id,
				callback, error, "DELETE");
	};

	/*
	* Executes the specified SOQL query.
	* @param soql a string containing the query to execute - e.g. "SELECT Id,
	*             Name from Account ORDER BY Name LIMIT 20"
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.query = function (soql, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/query?q=' + encodeURIComponent(soql),
				callback, error);
	};

	/*
	* Queries the next set of records based on pagination.
	* <p>This should be used if performing a query that retrieves more than can be returned
	* in accordance with http://www.salesforce.com/us/developer/docs/api_rest/Content/dome_query.htm</p>
	* <p>Ex: forcetkClient.queryMore( successResponse.nextRecordsUrl, successHandler, failureHandler )</p>
	*
	* @param url - the url retrieved from nextRecordsUrl or prevRecordsUrl
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	 forcetk.Client.prototype.queryMore = function (url, callback, error) {
		'use strict';
		//-- ajax call adds on services/data to the url call, so only send the url after
		var serviceData = "services/data",
				index = url.indexOf(serviceData);

		if (index > -1) {
				url = url.substr(index + serviceData.length);
		}

		return this.ajax(url, callback, error);
	};

	/*
	* Executes the specified SOSL search.
	* @param sosl a string containing the search to execute - e.g. "FIND
	*             {needle}"
	* @param callback function to which response will be passed
	* @param [error=null] function to which jqXHR will be passed in case of error
	*/
	forcetk.Client.prototype.search = function (sosl, callback, error) {
		'use strict';
		return this.ajax('/' + this.apiVersion + '/search?q=' + encodeURIComponent(sosl),
				callback, error);
	};
}
