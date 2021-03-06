"use strict";

import {
    isEpisode,
    isError,
    isMovie,
    isTvshow,
    OmdbEpisode,
    OmdbError,
    OmdbMovie,
    OmdbSearch,
    OmdbSearchResult,
    OmdbSeason,
    OmdbTvshow,
} from "./interfaces";

import rp = require("request-promise-native");

const omdbapi = "https://www.omdbapi.com/";

/**
 * Options to manipulate movie fetching
 */
export interface MovieOpts {
    /**
     * API key for omdbapi. Needed to make any API calls.
     *
     * Get one [here](https://www.patreon.com/posts/api-is-going-10743518)
     */
    apiKey: string;

    /**
     * timeout in milliseconds to wait before giving up on a request
     */
    timeout?: number;
}

/**
 * An explicit request for a movie. Does not do searching, this is meant
 * to specify *one specific* movie.
 */
export interface MovieRequest {
    /**
     * Name of the movie
     */
    name?: string;

    /**
     * imdb id of the movie
     */
    id?: string;

    /**
     * Year that the movie was released
     */
    year?: number;

    /**
     * Whether or not to request a short plot. Default is full plot.
     */
    short_plot?: boolean;

    /**
     * Metadata about how we're retrieving the request
     */
    opts: MovieOpts;
}

/**
 * Type of media we're searching for
 */
export type RequestType = "movie"
    | "series"
    | "episode"
    | "game";

/**
 * A search for a movie. This will fetch multiple results based on fuzzy matches
 * for a particular piece of media.
 */
export interface SearchRequest {
    /**
     * Title of the media that we're looking for
     */
    title: string;

    /**
     * Type of media we're looking for
     */
    reqtype?: RequestType;

    /**
     * Year that the piece of media was released
     */
    year?: number;
}

function reqtoqueryobj(req: SearchRequest, apikey: string, page: number): object {
    return {
        apikey,
        page,
        r: "json",
        s: req.title,
        type: req.reqtype,
        y: req.year,
    };
}

const trans_table = {
    Genre: "genres",
    Language: "languages",
    imdbRating: "rating",
    imdbVotes: "votes",
};

export class Episode {
    public season: number;
    public name: string;
    public episode: number;
    public released: Date;
    public imdbid: string;
    public rating: number;
    public year: number;

    constructor(obj: OmdbEpisode, season: number) {
        this.season = season;
        for (const attr of Object.getOwnPropertyNames(obj)) {
            if (attr === "Released") {
                const val = new Date(obj[attr]);
                if (isNaN(val.getTime())) {
                    throw new TypeError("invalid release date");
                }
                this.released = val;
            } else if (attr === "imdbRating") {
                this[trans_table[attr]] = parseFloat(obj[attr]);
            } else if (attr === "Episode" || attr === "Year") {
                const attr_name = attr.toLowerCase();
                this[attr_name] = parseInt(obj[attr], 10);
                if (isNaN(this[attr_name])) {
                    throw new TypeError(`invalid ${attr_name}`);
                }
            } else if (attr === "Title") {
                this.name = obj[attr];
            } else if (trans_table[attr] !== undefined) {
                this[trans_table[attr]] = obj[attr];
            } else {
                this[attr.toLowerCase()] = obj[attr];
            }
        }
    }
}

export class Movie {
    public imdbid: string;
    public imdburl: string;
    public genres: string;
    public languages: string;
    public country: string;
    public votes: string;
    public series: boolean;
    public rating: number;
    public runtime: string;
    public title: string;
    public year: number;

    public type: string;
    public poster: string;
    public metascore: string;
    public plot: string;
    public rated: string;
    public director: string;
    public writer: string;
    public actors: string;
    public released: Date;

    protected _year_data: string;

    constructor(obj: OmdbMovie) {
        for (const attr of Object.getOwnPropertyNames(obj)) {
            if (attr === "Year") {
                this._year_data = obj[attr];
                // check for emdash as well
                if (!obj[attr].match(/\d{4}[\-–](?:\d{4})?/)) {
                    const val = parseInt(obj[attr], 10);
                    if (isNaN(val)) {
                        throw new TypeError("invalid year");
                    }
                    this[attr.toLowerCase()] = val;
                }
            } else if (attr === "Released") {
                const val = new Date(obj[attr]);
                if (isNaN(val.getTime())) {
                    throw new TypeError("invalid release date");
                }
                this.released = val;
            } else if (attr === "imdbRating") {
                const val = parseFloat(obj[attr]);
                if (isNaN(val)) {
                    throw new TypeError("invalid rating");
                }
                this[trans_table[attr]] = parseFloat(obj[attr]);
            } else if (trans_table[attr] !== undefined) {
                this[trans_table[attr]] = obj[attr];
            } else {
                this[attr.toLowerCase()] = obj[attr];
            }
        }

        this.series = this.type === "movie" ? false : true;
        this.imdburl = "https://www.imdb.com/title/" + this.imdbid;
    }
}

export class TVShow extends Movie {
    public start_year;
    public end_year;
    public totalseasons;

    private _episodes: Episode[] = [];
    private opts: MovieOpts;

    constructor(object: OmdbTvshow, opts: MovieOpts) {
        super(object);
        const years = this._year_data.split("-");
        this.start_year = parseInt(years[0], 10);
        this.end_year = parseInt(years[1], 10) ? parseInt(years[1], 10) : null;
        this.totalseasons = parseInt(this.totalseasons, 10);
        this.opts = opts;
    }

    /**
     * Fetches episodes of a TV show
     *
     * @param cb optional callback that gets any errors or episodes
     *
     * @return Promise yielding list of episodes
     */
    public episodes(cb?: (err: Error, data: Episode[]) => any): Promise<Episode[]> {
        if (this._episodes.length !== 0) {
            if (cb) {
                return cb(undefined, this._episodes);
            } else {
                return Promise.resolve(this._episodes);
            }
        }

        const tvShow = this;

        const funcs = [];
        for (let i = 1; i <= tvShow.totalseasons; i++) {
            const reqopts = {
                json: true,
                qs: {
                    Season: i,
                    apikey: tvShow.opts.apiKey,
                    i: tvShow.imdbid,
                    r: "json",
                },
                timeout: undefined,
                url: omdbapi,
                withCredentials: false,
            };

            if ("timeout" in this.opts) {
                reqopts.timeout = this.opts.timeout;
            }

            funcs.push(rp(reqopts));
        }

        const prom = Promise.all(funcs)
            .then((ep_data: OmdbSeason[] | OmdbError[]) => {
                const eps: Episode[] = [];

                for (const datum of ep_data) {
                    if (isError(datum)) {
                        const err = new ImdbError(datum.Error);
                        if (cb) {
                            return cb(err, undefined);
                        }

                        throw err;
                    }

                    const season = parseInt(datum.Season, 10);
                    for (const ep of Object.getOwnPropertyNames(datum.Episodes)) {
                        eps.push(new Episode(datum.Episodes[ep], season));
                    }
                }

                tvShow._episodes = eps;
                if (cb) {
                    return cb(undefined, eps);
                }

                return Promise.resolve(eps);
            });

        if (cb) {
            prom.catch((err) => {
                return cb(err, undefined);
            });
        } else {
            return prom;
        }
    }
}

export class SearchResult {
    public title: string;
    public year: number;
    public imdbid: string;
    public type: RequestType;
    public poster: string;

    constructor(obj: OmdbSearchResult) {
        for (const attr of Object.getOwnPropertyNames(obj)) {
            if (attr === "Year") {
                this[attr.toLowerCase()] = parseInt(obj[attr], 10);
            } else {
                this[attr.toLowerCase()] = obj[attr];
            }
        }
    }
}

export class SearchResults {
    public results: SearchResult[] = [];
    public totalresults: number;
    private page: number;
    private opts: MovieOpts;
    private req: SearchRequest;

    constructor(obj: OmdbSearch, page: number, opts: MovieOpts, req: SearchRequest) {
        this.page = page;
        this.req = req;
        this.opts = opts;

        for (const attr of Object.getOwnPropertyNames(obj)) {
            if (attr === "Search") {
                for (const result of obj.Search) {
                    this.results.push(new SearchResult(result));
                }
            } else if (attr === "totalResults") {
                this[attr.toLowerCase()] = parseInt(obj[attr], 10);
            } else {
                this[attr.toLowerCase()] = obj[attr];
            }
        }
    }

    /**
     * Returns the next page of search results
     *
     * @return next page of search results
     */
    public next(): Promise<SearchResults> {
        return search(this.req, this.opts, this.page + 1);
    }
}

export class ImdbError {
    public name: string = "imdb api error";

    constructor(public message: string) { }
}

/**
 * Fetches a movie by arbitrary criteria
 *
 * @param req set of requirements to search for
 * @param opts options that modify a search
 * @param cb optional callback to execute after fetching data
 *
 * @return a promise yielding a movie
 */
export function getReq(req: MovieRequest, cb?: (err: Error, data: Movie | Episode) => any): Promise<Movie> {

    if (req.opts === undefined || !req.opts.hasOwnProperty("apiKey")) {
        const err = new ImdbError("Missing api key in opts");
        if (cb) {
            return cb(err, undefined);
        } else {
            return Promise.reject(err);
        }
    }

    const qs = {
        apikey: req.opts.apiKey,
        i: undefined,
        plot: req.short_plot ? "short" : "full",
        r: "json",
        t: undefined,
        y: req.year,
    };

    if (req.name) {
        qs.t = req.name;
    } else if (req.id) {
        qs.i = req.id;
    } else {
        const err = new ImdbError("Missing one of req.id or req.name");
        if (cb) {
            return cb(err, undefined);
        } else {
            return Promise.reject(err);
        }
    }

    const reqopts = {
        json: true,
        qs,
        timeout: undefined,
        url: omdbapi,
        withCredentials: false,
    };

    if ("timeout" in req.opts) {
        reqopts.timeout = req.opts.timeout;
    }

    const prom = rp(reqopts).then((data: OmdbMovie | OmdbError) => {
        let ret: Movie | Episode;
        if (isError(data)) {
            const err = new ImdbError(data.Error + ": " + (req.name ? req.name : req.id));
            if (cb) {
                return cb(err, undefined);
            } else {
                return Promise.reject(err);
            }
        } else {
            if (isMovie(data)) {
                ret = new Movie(data);
            } else if (isTvshow(data)) {
                ret = new TVShow(data, req.opts);
            } else if (isEpisode(data)) {
                ret = new Episode(data, 30);
            } else {
                const err = new ImdbError(`type: '${data.Type}' is not valid`);
                if (cb) {
                    return cb(err, undefined);
                } else {
                    return Promise.reject(err);
                }
            }

            if (cb) {
                return cb(undefined, ret);
            }

            return Promise.resolve(ret);
        }
    });

    if (cb) {
        prom.catch((err) => {
            cb(err, undefined);
        });
    } else {
        return prom;
    }
}

/**
 * @deprecated use getReq instead
 *
 * Gets a movie by name
 *
 * @param name name of movie to search for
 * @param opts options that modify a search
 * @param cb optional callback to execute after finding results
 *
 * @return a promise yielding a movie
 */
export function get(name: string, opts: MovieOpts, cb?: (err: Error, data: Movie) => any): Promise<Movie> {
    return getReq({ id: undefined, opts, name }, cb);
}

/**
 * @deprecated use getReq instead
 *
 * Gets a movie by id
 *
 * @param imdbid id to search for
 * @param opts options that modify a search
 * @param cb optional callback to execute after finding results
 *
 * @return a promise yielding a movie
 */
export function getById(imdbid: string, opts: MovieOpts, cb?: (err: Error, data: Movie) => any): Promise<Movie> {
    return getReq({ id: imdbid, opts, name: undefined }, cb);
}

/**
 * Searches for a movie by arbitrary criteria
 *
 * @param req set of requirements to search for
 * @param opts options that modify a search
 * @param page page number to return
 *
 * @return a promise yielding search results
 */
export function search(req: SearchRequest, opts: MovieOpts, page?: number): Promise<SearchResults> {
    if (page === undefined) {
        page = 1;
    }

    const qs = reqtoqueryobj(req, opts.apiKey, page);
    const reqopts = { qs, url: omdbapi, json: true, timeout: undefined, withCredentials: false };
    if ("timeout" in opts) {
        reqopts.timeout = opts.timeout;
    }

    const prom = rp(reqopts).then((data: OmdbSearch | OmdbError) => {
        if (isError(data)) {
            const err = new ImdbError(`${data.Error}: ${req.title}`);
            return Promise.reject(err);
        } else {
            return Promise.resolve(new SearchResults(data, page, opts, req));
        }
    });

    return prom;
}
