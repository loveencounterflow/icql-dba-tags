(function() {
  'use strict';
  var CND, Dba, E, SQL, badge, debug, echo, freeze, help, info, isa, lets, rpr, type_of, types, urge, validate, validate_list_of, warn, whisper;

  //###########################################################################################################
  CND = require('cnd');

  rpr = CND.rpr;

  badge = 'ICQL-DBA';

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
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.declare('dbatags_tag', {
    tests: {
      '@isa.nonempty_text x': function(x) {
        return this.isa.nonempty_text(x);
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
      '@isa.integer x.hi': function(x) {
        return this.isa.integer(x.hi);
      },
      '@isa.dbatags_tag x.tag': function(x) {
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
  types.declare('dbatags_tags_from_id_cfg', {
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
  types.declare('dbatags_parse_tagex_cfg', {
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
  types.defaults = {
    dbatags_constructor_cfg: {
      dba: null,
      prefix: 't_',
      fallbacks: false
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
  this.Dtags = (function() {
    class Dtags {
      //---------------------------------------------------------------------------------------------------------
      constructor(cfg) {
        validate.dbatags_constructor_cfg(this.cfg = {...types.defaults.dbatags_constructor_cfg, ...cfg});
        //.......................................................................................................
        if (this.cfg.dba != null) {
          // debug '^4453334-1^'
          this.dba = this.cfg.dba;
          delete this.cfg.dba;
        } else {
          // debug '^4453334-2^'
          this.dba = new Dba();
        }
        // #.......................................................................................................
        // if @cfg.dba2?
        //   debug '^4453334-3^'
        //   @dba2 = @cfg.dba2
        //   delete @cfg.dba2
        // else
        //   debug '^4453334-4^'
        //   @dba2 = new Dba()
        //   ### TAINT won't work with paths set to '' or ':memory:' ###
        //   @dba2.open { path: @dba.sqlt.name, }
        //   debug '^34342^', rpr @dba.sqlt.name
        //   debug '^34342^', rpr @dba2.sqlt.name
        //.......................................................................................................
        this.cfg = freeze(this.cfg);
        // @_assert_dba_and_dba2_refer_to_same_db()
        this._tag_max_nr = 0;
        this._create_db_structure();
        this._compile_sql();
        this._create_sql_functions();
        return void 0;
      }

      // #---------------------------------------------------------------------------------------------------------
      // _assert_dba_and_dba2_refer_to_same_db: ->
      //   debug '^3443^', @dba.sqlt
      //   debug '^3443^', @dba.sqlt.name
      //   debug '^3443^', @dba2.sqlt
      //   debug '^3443^', @dba2.sqlt.name
      //   rnd = Math.floor Math.random() * 1e18
      //   @dba.execute SQL"drop table if exists #{@cfg.prefix}_test;"
      //   @dba.execute SQL"create table #{@cfg.prefix}_test ( id integer );"
      //   @dba.run SQL"insert into #{@cfg.prefix}_test values ( ? );", rnd
      //   r1  = @dba.list @dba.query    SQL"select id from #{@cfg.prefix}_test;"
      //   r2  = @dba2.list @dba2.query  SQL"select id from #{@cfg.prefix}_test;"
      //   debug '^33443^', { r1, r2, }
      //   @dba.execute SQL"drop table #{@cfg.prefix}_test;"
      //   return null

        //---------------------------------------------------------------------------------------------------------
      _create_db_structure() {
        var x;
        x = this.cfg.prefix;
        this.dba.execute(SQL`create table if not exists ${x}tags (
    nr      integer not null,
    tag     text    not null primary key,
    value   json    not null default 'true' );
create table if not exists ${x}tagged_ranges (
    nr      integer not null primary key,
    lo      integer not null,
    hi      integer not null,
    mode    boolean not null,
    tag     text    not null references ${x}tags ( tag ),
    value   json    not null );
create index if not exists ${x}tags_nr_idx on ${x}tags          ( nr );
create index if not exists ${x}idlohi_idx on  ${x}tagged_ranges ( lo, hi );
create index if not exists ${x}idhi_idx on    ${x}tagged_ranges ( hi );
create table if not exists ${x}tagged_ids_cache (
    id      integer not null primary key,
    tags    json    not null );`);
        return null;
      }

      //---------------------------------------------------------------------------------------------------------
      _compile_sql() {
        var x;
        x = this.cfg.prefix;
        this.sql = {
          insert_tag: SQL`insert into ${x}tags ( nr, tag, value )
  values ( $nr, $tag, $value );`,
          // on conflict ( tag ) do nothing;"""
          insert_tagged_range: SQL`insert into ${x}tagged_ranges ( lo, hi, mode, tag, value )
  values ( $lo, $hi, $mode, $tag, $value )`,
          tagchain_from_id: SQL`select
    nr,
    mode,
    tag,
    value
  from ${x}tagged_ranges
  where $id between lo and hi
  order by nr asc;`,
          cached_tags_from_id: SQL`select
    tags
  from ${x}tagged_ids_cache
  where id = $id;`,
          insert_cached_tags: SQL`insert into ${x}tagged_ids_cache ( id, tags )
  values ( $id, $tags );`,
          get_fallbacks: SQL`select * from ${x}tags
  order by nr;`
        };
        return null;
      }

      //---------------------------------------------------------------------------------------------------------
      _create_sql_functions() {
        var x;
        x = this.cfg.prefix;
        //.......................................................................................................
        this.dba.create_function({
          name: `${x}_tags_from_id`,
          deterministic: true,
          varargs: false,
          call: (id) => {
            var fallbacks, tagchain, tags;
            fallbacks = this.get_filtered_fallbacks();
            tagchain = this.tagchain_from_id({id});
            tags = this.tags_from_tagchain({tagchain});
            return JSON.stringify({...fallbacks, ...tags});
          }
        });
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
        this._clear_cache_for_range(cfg);
        return null;
      }

      //---------------------------------------------------------------------------------------------------------
      _clear_cache_for_range(cfg) {}

      //---------------------------------------------------------------------------------------------------------
      add_tagged_range(cfg) {
        validate.dbatags_add_tagged_range_cfg(cfg = {...types.defaults.dbatags_add_tagged_range_cfg, ...cfg});
        if (cfg.value == null) {
          cfg.value = cfg.mode === '+' ? true : false;
        }
        cfg.value = JSON.stringify(cfg.value);
        this.dba.run(this.sql.insert_tagged_range, cfg);
        return null;
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
      tags_from_id(cfg) {
        var R, id;
        validate.dbatags_tags_from_id_cfg(cfg = {...types.defaults.dbatags_tags_from_id_cfg, ...cfg});
        ({id} = cfg);
        R = [...(this.dba.query(this.sql.cached_tags_from_id, cfg))];
        if (R.length > 0) {
          return JSON.parse(R[0].tags);
        }
        R = this.get_filtered_fallbacks();
        Object.assign(R, this.tags_from_tagchain({
          tagchain: this.tagchain_from_id(cfg)
        }));
        this.dba.run(this.sql.insert_cached_tags, {
          id,
          tags: JSON.stringify(R)
        });
        return R;
      }

      //---------------------------------------------------------------------------------------------------------
      parse_tagex(cfg) {
        var error, match, mode, tag, tagex, value;
        validate.dbatags_parse_tagex_cfg(cfg = {...types.defaults.dbatags_parse_tagex_cfg, ...cfg});
        ({tagex} = cfg);
        if ((match = tagex.match(this.tagex_pattern)) == null) {
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

    };

    //---------------------------------------------------------------------------------------------------------
    /* TAINT pattern does not allow for escaped quotes */
    Dtags.prototype.tagex_pattern = /^(?<mode>[-+])(?<tag>[a-zA-Z_\/\$][-a-zA-Z0-9_\/\$]*)(:(?<value>[^-+]+|'.*'|".*"))?$/;

    return Dtags;

  }).call(this);

}).call(this);

//# sourceMappingURL=main.js.map