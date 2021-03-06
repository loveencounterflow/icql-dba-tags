(function() {
  'use strict';
  var CND, Dba, E, SQL, badge, debug, echo, freeze, guy, help, info, isa, lets, name_re, rpr, tagex_re, type_of, types, urge, validate, validate_list_of, warn, whisper;

  //###########################################################################################################
  CND = require('cnd');

  rpr = CND.rpr;

  badge = 'ICQL-DBA-TAGS';

  debug = CND.get_logger('debug', badge);

  warn = CND.get_logger('warn', badge);

  info = CND.get_logger('info', badge);

  urge = CND.get_logger('urge', badge);

  help = CND.get_logger('help', badge);

  whisper = CND.get_logger('whisper', badge);

  echo = CND.echo.bind(CND);

  //...........................................................................................................
  types = new (require('intertype')).Intertype();

  ({isa, type_of, validate, validate_list_of} = types.export());

  // { to_width }              = require 'to-width'
  SQL = String.raw;

  ({lets, freeze} = require('letsfreezethat'));

  E = require('./errors');

  ({Dba} = require('icql-dba'));

  guy = require('guy');

  //===========================================================================================================
  /* RegEx from https://github.com/loveencounterflow/paragate/blob/master/src/htmlish.grammar.coffee with
  the additional exlusion of `+`, `-`, ':' which are used in TagExes */
  name_re = /^[^-+:\s!?=\{\[\(<\/>\)\]\}'"]+$/u;

  //---------------------------------------------------------------------------------------------------------
  /* TAINT pattern does not allow for escaped quotes */
  /* TAINT re-use `name_re` */
  tagex_re = /^(?<mode>[-+])(?<tag>[a-zA-Z_\/\$][-a-zA-Z0-9_\/\$]*)(:(?<value>[^-+]+|'.*'|".*"))?$/u;

  //===========================================================================================================
  types.declare('dbatags_constructor_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      'x.prefix is a prefix': function(x) {
        if (!this.isa.text(x.prefix)) {
          return false;
        }
        if (x.prefix === '') {
          return true;
        }
        return /^[_a-z][_a-z0-9]*$/.test(x.prefix);
      },
      "x.fallbacks in [ true, false, 'all', ]": function(x) {
        var ref;
        return (ref = x.fallbacks) === true || ref === false || ref === 'all';
      },
      "@isa.integer x.first_id": function(x) {
        return this.isa.integer(x.first_id);
      },
      "@isa.integer x.last_id": function(x) {
        return this.isa.integer(x.last_id);
      },
      "( @type_of x.dba ) is 'dba'": function(x) {
        return (this.type_of(x.dba)) === 'dba';
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_tag', {
    tests: {
      '( x.match name_re )?': function(x) {
        return (x.match(name_re)) != null;
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_mode', {
    tests: {
      "x in [ '+', '-', ]": function(x) {
        return x === '+' || x === '-';
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_add_tag_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.dbatags_tag x.tag': function(x) {
        return this.isa.dbatags_tag(x.tag);
      },
      '@isa.dbatags_mode x.mode': function(x) {
        return this.isa.dbatags_mode(x.mode);
      },
      'not x.nr?': function(x) {
        return x.nr == null;
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_add_tagged_range_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.integer x.lo': function(x) {
        return this.isa.integer(x.lo);
      },
      /* TAINT add boundary check */'@isa.integer x.hi': function(x) {
        return this.isa.integer(x.hi);
      },
      /* TAINT add boundary check */'@isa.dbatags_tag x.tag': function(x) {
        return this.isa.dbatags_tag(x.tag);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_tagchain_from_id_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.integer x.id': function(x) {
        return this.isa.integer(x.id);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  /* TAINT add boundary check */  types.declare('dbatags_tags_from_id_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.integer x.id': function(x) {
        return this.isa.integer(x.id);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  /* TAINT add boundary check */  types.declare('dbatags_parse_tagex_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.nonempty_text x.tagex': function(x) {
        return this.isa.nonempty_text(x.tagex);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_tags_from_tagchain_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.list x.tagchain': function(x) {
        return this.isa.list(x.tagchain);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_tags_from_tagexchain_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_markup_text_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.text x.text': function(x) {
        return this.isa.text(x.text);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.defaults = {
    dbatags_constructor_cfg: {
      dba: null,
      prefix: 't_',
      fallbacks: false,
      first_id: 0x000000,
      last_id: 0x10ffff
    },
    dbatags_add_tag_cfg: {
      nr: null,
      mode: '+',
      tag: null,
      value: false
    },
    dbatags_add_tagged_range_cfg: {
      mode: '+',
      tag: null,
      lo: null,
      hi: null,
      value: null
    },
    dbatags_parse_tagex_cfg: {
      tagex: null
    },
    dbatags_tagchain_from_id_cfg: {
      id: null
    },
    dbatags_tags_from_id_cfg: {
      id: null
    },
    dbatags_tags_from_tagchain_cfg: {
      tagchain: null
    },
    dbatags_tags_from_tagexchain_cfg: {
      tagexchain: null
    }
  };

  //===========================================================================================================
  this.Dtags = class Dtags {
    //---------------------------------------------------------------------------------------------------------
    constructor(cfg) {
      validate.dbatags_constructor_cfg(this.cfg = {...types.defaults.dbatags_constructor_cfg, ...cfg});
      //.......................................................................................................
      guy.props.def(this, 'dba', {
        enumerable: false,
        value: this.cfg.dba
      });
      delete this.cfg.dba;
      //.......................................................................................................
      this.cfg = freeze(this.cfg);
      this._tag_max_nr = 0;
      this._cache_filled = false;
      this._text_regions_re = null/* TAINT implicit cache interaction */
      this._create_db_structure();
      this._compile_sql();
      this._create_sql_functions();
      return void 0;
    }

    //---------------------------------------------------------------------------------------------------------
    _create_db_structure() {
      var first_id, last_id, prefix;
      ({prefix, first_id, last_id} = this.cfg);
      this.dba.execute(SQL`create table if not exists ${prefix}tags (
    nr      integer not null,
    tag     text    not null primary key,
    value   json    not null default 'true' );
create table if not exists ${prefix}tagged_ranges (
    nr      integer not null primary key,
    lo      integer not null,
    hi      integer not null,
    mode    boolean not null,
    tag     text    not null references ${prefix}tags ( tag ),
    value   json    not null );
create index if not exists ${prefix}tags_nr_idx on ${prefix}tags          ( nr );
create index if not exists ${prefix}idlohi_idx on  ${prefix}tagged_ranges ( lo, hi );
create index if not exists ${prefix}idhi_idx on    ${prefix}tagged_ranges ( hi );
create table if not exists ${prefix}contiguous_ranges (
    lo      integer not null,
    hi      integer not null,
    tags    json    not null,
    primary key ( lo, hi ) );
create view ${prefix}_potential_inflection_points as
  select id from ( select cast( null as integer ) as id where false
    union select ${first_id}
    union select ${last_id}
    union select distinct lo      from ${prefix}tagged_ranges
    union select distinct hi + 1  from ${prefix}tagged_ranges )
  order by id asc;
create view ${prefix}tags_and_rangelists as
  select
    'g' || row_number() over ()     as key,
    tags                            as tags,
    ${prefix}collect_many( lo, hi ) as ranges
  from ${prefix}contiguous_ranges
  group by tags
  order by tags;`);
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    _compile_sql() {
      var prefix, sql;
      prefix = this.cfg.prefix;
      sql = {
        insert_tag: SQL`insert into ${prefix}tags ( nr, tag, value )
  values ( $nr, $tag, $value );`,
        // on conflict ( tag ) do nothing;"""
        insert_tagged_range: SQL`insert into ${prefix}tagged_ranges ( lo, hi, mode, tag, value )
  values ( $lo, $hi, $mode, $tag, $value )`,
        insert_contiguous_range: SQL`insert into ${prefix}contiguous_ranges ( lo, hi, tags )
  values ( $lo, $hi, $tags )`,
        tagchain_from_id: SQL`select
    nr,
    mode,
    tag,
    value
  from ${prefix}tagged_ranges
  where $id between lo and hi
  order by nr asc;`,
        cached_tags_from_id: SQL`select
    tags
  from ${prefix}contiguous_ranges
  where $id between lo and hi
  limit 1;`,
        get_fallbacks: SQL`select * from ${prefix}tags
  order by nr;`,
        potential_inflection_points: SQL`select id from ${prefix}_potential_inflection_points;`,
        truncate_contiguous_ranges: SQL`delete from ${prefix}contiguous_ranges;`,
        get_contiguous_ranges: SQL`select * from ${prefix}contiguous_ranges order by lo, hi, tags;`,
        get_tagged_ranges: SQL`select nr, lo, hi, mode, tag, value
from ${this.cfg.prefix}tagged_ranges
order by nr;`,
        get_tags_and_rangelists: SQL`select key, tags, ranges
from ${this.cfg.prefix}tags_and_rangelists
order by key;`
      };
      guy.props.def(this, 'sql', {
        enumerable: false,
        value: sql
      });
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    _create_sql_functions() {
      var prefix;
      prefix = this.cfg.prefix;
      this.f = {};
      // #.......................................................................................................
      // @dba.create_function
      //   name:           "#{prefix}_tags_from_id",
      //   deterministic:  true,
      //   varargs:        false,
      //   call:           ( id ) =>
      //     fallbacks = @get_filtered_fallbacks()
      //     tagchain  = @tagchain_from_id { id, }
      //     tags      = @tags_from_tagchain { tagchain, }
      //     return JSON.stringify { fallbacks..., tags..., }
      //.......................................................................................................
      /* TAINT put these into separate module like `icql-dba-standard` */
      this.dba.create_window_function({
        name: prefix + 'collect',
        varargs: false,
        start: function() {
          return [];
        },
        step: function(total, element) {
          total.push(element);
          return total;
        },
        inverse: function(total, dropped) {
          total.pop();
          return total;
        },
        result: function(total) {
          return JSON.stringify(total);
        }
      });
      //.......................................................................................................
      this.dba.create_window_function({
        name: prefix + 'collect_many',
        varargs: true,
        start: function() {
          return [];
        },
        step: function(total, ...elements) {
          total.push(elements);
          return total;
        },
        inverse: function(total, dropped) {
          total.pop();
          return total;
        },
        result: function(total) {
          return JSON.stringify(total);
        }
      });
      //.......................................................................................................
      this.f.cid_from_chr = function(chr) {
        return chr.codePointAt(0);
      };
      this.f.chr_from_cid = function(cid) {
        return String.fromCodePoint(cid);
      };
      this.f.to_hex = function(cid) {
        return '0x' + cid.toString(16);
      };
      this.dba.create_function({
        name: 'chr_from_cid',
        call: this.f.chr_from_cid
      });
      this.dba.create_function({
        name: 'cid_from_chr',
        call: this.f.cid_from_chr
      });
      this.dba.create_function({
        name: 'to_hex',
        call: this.f.to_hex
      });
      //.......................................................................................................
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    add_tag(cfg) {
      validate.dbatags_add_tag_cfg(cfg = {...types.defaults.dbatags_add_tag_cfg, ...cfg});
      if (cfg.value == null) {
        cfg.value = true;
      }
      cfg.value = JSON.stringify(cfg.value);
      this._tag_max_nr++;
      cfg.nr = this._tag_max_nr;
      this.dba.run(this.sql.insert_tag, cfg);
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    add_tagged_range(cfg) {
      validate.dbatags_add_tagged_range_cfg(cfg = {...types.defaults.dbatags_add_tagged_range_cfg, ...cfg});
      if (cfg.value == null) {
        cfg.value = cfg.mode === '+' ? true : false;
      }
      cfg.value = JSON.stringify(cfg.value);
      this._on_add_tagged_range();
      this.dba.run(this.sql.insert_tagged_range, cfg);
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    tagchain_from_id(cfg) {
      var R, ref, row;
      validate.dbatags_tagchain_from_id_cfg(cfg = {...types.defaults.dbatags_tagchain_from_id_cfg, ...cfg});
      R = [];
      ref = this.dba.query(this.sql.tagchain_from_id, cfg);
      for (row of ref) {
        row.value = JSON.parse(row.value);
        R.push(row);
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    _tags_from_id_uncached(cfg) {
      var R, id;
      validate.dbatags_tags_from_id_cfg(cfg = {...types.defaults.dbatags_tags_from_id_cfg, ...cfg});
      ({id} = cfg);
      R = this.get_filtered_fallbacks();
      Object.assign(R, this.tags_from_tagchain({
        tagchain: this.tagchain_from_id(cfg)
      }));
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    tags_from_id(cfg) {
      if (!this._cache_filled) {
        /* TAINT implicit cache interaction */
        this._create_minimal_contiguous_ranges();
      }
      validate.dbatags_tags_from_id_cfg(cfg = {...types.defaults.dbatags_tags_from_id_cfg, ...cfg});
      return JSON.parse(this.dba.first_value(this.dba.query(this.sql.cached_tags_from_id, cfg)));
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    parse_tagex(cfg) {
      var error, match, mode, tag, tagex, value;
      validate.dbatags_parse_tagex_cfg(cfg = {...types.defaults.dbatags_parse_tagex_cfg, ...cfg});
      ({tagex} = cfg);
      if ((match = tagex.match(tagex_re)) == null) {
        throw new E.Dtags_invalid_tagex('^dtags@777^', tagex);
      }
      ({mode, tag, value} = match.groups);
      switch (mode) {
        case '+':
          if (value == null) {
            value = 'true';
          }
          break;
        case '-':
          if (value != null) {
            throw new E.Dtags_subtractive_value('^dtags@778^', tagex);
          }
          value = 'false';
      }
      try {
        value = JSON.parse(value);
      } catch (error1) {
        error = error1;
        throw new E.Dtags_illegal_tagex_value_literal('^dtags@779^', tagex, error.message);
      }
      return {mode, tag, value};
    }

    //---------------------------------------------------------------------------------------------------------
    tags_from_tagchain(cfg) {
      var R, i, len, mode, tag, tagchain, value;
      /* TAINT make deletion bahvior configurable */
      /* TAINT allow to seed result with fallbacks */
      validate.dbatags_tags_from_tagchain_cfg(cfg = {...types.defaults.dbatags_tags_from_tagchain_cfg, ...cfg});
      R = {};
      ({tagchain} = cfg);
      if (tagchain.length === 0) {
        return R;
      }
      for (i = 0, len = tagchain.length; i < len; i++) {
        tag = tagchain[i];
        ({mode, tag, value} = tag);
        switch (mode) {
          case '+':
            R[tag] = value;
            break;
          case '-':
            delete R[tag];
            break;
          default:
            // when '-' then R[ tag ] = value
            throw new E.Dtags_unexpected('^dtags@780^', `unknown tag mode in ${rpr(tag)}`);
        }
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    tags_from_tagexchain(cfg) {
      var tagchain, tagex;
      validate.dbatags_tags_from_tagexchain_cfg(cfg = {...types.defaults.dbatags_tags_from_tagexchain_cfg, ...cfg});
      tagchain = (function() {
        var i, len, ref, results;
        ref = cfg.tagexchain;
        results = [];
        for (i = 0, len = ref.length; i < len; i++) {
          tagex = ref[i];
          results.push(this.parse_tagex({tagex}));
        }
        return results;
      }).call(this);
      return this.tags_from_tagchain({tagchain});
    }

    //=========================================================================================================
    // TAGGED TEXT REGIONS
    //---------------------------------------------------------------------------------------------------------
    _on_add_tagged_range() {
      /* TAINT implicit cache interaction */
      this.dba.execute(this.sql.truncate_contiguous_ranges);
      this._text_regions_re = null/* TAINT mark cached value or collect in `@cache` */
      this._cache_filled = false;
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    _create_minimal_contiguous_ranges() {
      var entry, hi, i, id, ids_and_tags, idx, j, last_id, last_idx, lo, pi_ids/* TAINT implicit cache interaction */, prv_tags, ref, ref1, row, tags;
      /* Iterate over all potential inflection points (the boundaries of all tagged ranges) to find at which
         points an actual change in the tagset occurs; these endpoints are then (together with the tagsets)
         inserted into table `t_contiguous_ranges`. */
      this._on_add_tagged_range();
      pi_ids = (function() {
        var ref, results;
        ref = this.dba.query(this.sql.potential_inflection_points);
        results = [];
        for (row of ref) {
          results.push(row.id);
        }
        return results;
      }).call(this);
      last_idx = pi_ids.length - 1;
      last_id = pi_ids[last_idx];
      prv_tags = null;
      ids_and_tags = [];
//.......................................................................................................
      for (idx = i = 0, ref = pi_ids.length - 1; (0 <= ref ? i < ref : i > ref); idx = 0 <= ref ? ++i : --i) {
        id = pi_ids[idx];
        tags = JSON.stringify(this._tags_from_id_uncached({id}));
        if (tags === prv_tags) {
          continue;
        }
        prv_tags = tags;
        ids_and_tags.push({id, tags});
      }
      ids_and_tags.push({
        id: last_id,
        tags: null
      });
//.......................................................................................................
      for (idx = j = 0, ref1 = ids_and_tags.length - 1; (0 <= ref1 ? j < ref1 : j > ref1); idx = 0 <= ref1 ? ++j : --j) {
        entry = ids_and_tags[idx];
        lo = entry.id;
        hi = ids_and_tags[idx + 1].id - 1;
        tags = entry.tags;
        this.dba.run(this.sql.insert_contiguous_range, {lo, hi, tags});
      }
      //.......................................................................................................
      this._cache_filled = true/* TAINT implicit cache interaction */
      return null;
    }

    //---------------------------------------------------------------------------------------------------------
    _regex_chr_class_from_range(range) {
      /* TAINT make addition of spaces configurable, e.g. as `all_groups_extra: '\\s'`  */
      var hi, lo;
      [lo, hi] = range;
      if (lo === hi) {
        return `\\u{${lo.toString(16)}}`;
      }
      return `\\u{${lo.toString(16)}}-\\u{${hi.toString(16)}}`;
    }

    //---------------------------------------------------------------------------------------------------------
    get_tagsets_by_keys() {
      var R, key, ref, tags, y;
      if (!this._cache_filled/* TAINT implicit cache interaction */) {
        this._create_minimal_contiguous_ranges();
      }
      R = {};
      ref = this.dba.query(SQL`select * from ${this.cfg.prefix}tags_and_rangelists;`);
      for (y of ref) {
        ({key, tags} = y);
        R[key] = JSON.parse(tags);
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    _build_text_regions_re() {
      var key, parts, range, ranges, ref, tags, y;
      parts = [];
      ref = this.dba.query(SQL`select * from ${this.cfg.prefix}tags_and_rangelists;`);
      for (y of ref) {
        ({key, tags, ranges} = y);
        ranges = JSON.parse(ranges);
        ranges = ((function() {
          var i, len, results;
          results = [];
          for (i = 0, len = ranges.length; i < len; i++) {
            range = ranges[i];
            results.push(this._regex_chr_class_from_range(range));
          }
          return results;
        }).call(this)).join('');
        parts.push(`(?<${key}>[${ranges}]+)`);
      }
      parts = parts.join('|');
      return this._text_regions_re = new RegExp(parts, 'gu');
    }

    //---------------------------------------------------------------------------------------------------------
    find_tagged_regions(text) {
      /* TAINT use `cfg` */
      /* TAINT may want to use new `/.../d` flag when it becomes available */
      var R, key, match, new_stop, part, re, ref, ref1, ref2, start, stop;
      re = (ref = this._text_regions_re) != null ? ref : this._build_text_regions_re();
      // debug '^33436^', re
      /* TAINT implicit cache interaction */      R = [];
      stop = 0;
      ref1 = text.matchAll(re);
      //.......................................................................................................
      for (match of ref1) {
        ({
          index: start
        } = match);
        ref2 = match.groups;
        for (key in ref2) {
          part = ref2[key];
          if (part != null) {
            break;
          }
        }
        if (start > stop) {
          part = text.slice(stop, start);
          // warn stop, start, CND.reverse rpr part
          new_stop = start + part.length;
          R.push({
            key: 'missing',
            start: stop,
            stop: new_stop,
            part
          });
          stop = new_stop;
          continue;
        }
        //.....................................................................................................
        stop += part.length;
        // info start, stop, key, rpr part
        R.push({key, start, stop, part});
      }
      //.......................................................................................................
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    _markup_text(cfg) {
      var R, i, len, ref, region, regions, tagsets, text;
      validate.dbatags_markup_text_cfg(cfg = {...types.defaults.dbatags_markup_text_cfg, ...cfg});
      R = [];
      ({text} = cfg);
      tagsets = this.get_tagsets_by_keys();
      ref = regions = this.find_tagged_regions(text);
      for (i = 0, len = ref.length; i < len; i++) {
        region = ref[i];
        region.tags = tagsets[region.key];
        R.push(region);
      }
      return R;
    }

    //=========================================================================================================
    // TABLE GETTERS
    //---------------------------------------------------------------------------------------------------------
    get_tags() {
      var R, fallback, nr, ref, sql, tag, y;
      R = {};
      sql = SQL`select nr, tag, value as fallback from ${this.cfg.prefix}tags order by nr;`;
      ref = this.dba.query(sql);
      for (y of ref) {
        ({nr, tag, fallback} = y);
        fallback = JSON.parse(fallback);
        R[tag] = {nr, fallback};
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    get_tagged_ranges() {
      var R, hi, lo, mode, nr, ref, tag, value, y;
      R = [];
      ref = this.dba.query(this.sql.get_tagged_ranges);
      for (y of ref) {
        ({nr, lo, hi, mode, tag, value} = y);
        value = JSON.parse(value);
        R.push({nr, lo, hi, mode, tag, value});
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    get_filtered_fallbacks() {
      var R, tag, value;
      if (this.cfg.fallbacks === false) {
        return {};
      }
      R = this.get_fallbacks();
      if (this.cfg.fallbacks === 'all') {
        return R;
      }
      for (tag in R) {
        value = R[tag];
        if (value === false) {
          delete R[tag];
        }
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    get_fallbacks() {
      var R, ref, row;
      R = {};
      ref = this.dba.query(this.sql.get_fallbacks);
      for (row of ref) {
        R[row.tag] = JSON.parse(row.value);
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    get_continuous_ranges(cfg) {
      var R, hi, lo, ref, tags, y;
      if (!this._cache_filled) {
        /* TAINT implicit cache interaction */
        this._create_minimal_contiguous_ranges();
      }
      R = [];
      ref = this.dba.query(this.sql.get_contiguous_ranges);
      for (y of ref) {
        ({lo, hi, tags} = y);
        tags = JSON.parse(tags);
        R.push({lo, hi, tags});
      }
      return R;
    }

    //---------------------------------------------------------------------------------------------------------
    get_tags_and_rangelists(cfg) {
      var R, key, ranges, ref, tags, y;
      if (!this._cache_filled) {
        /* TAINT implicit cache interaction */
        this._create_minimal_contiguous_ranges();
      }
      R = [];
      ref = this.dba.query(this.sql.get_tags_and_rangelists);
      for (y of ref) {
        ({key, tags, ranges} = y);
        tags = JSON.parse(tags);
        ranges = JSON.parse(ranges);
        R.push({key, tags, ranges});
      }
      return R;
    }

  };

}).call(this);

//# sourceMappingURL=main.js.map