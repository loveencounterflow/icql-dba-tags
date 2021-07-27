(function() {
  'use strict';
  var CND, SQL, badge, debug, echo, freeze, help, info, isa, jp, jr, lets, rpr, type_of, types, urge, validate, validate_list_of, warn, whisper;

  //###########################################################################################################
  CND = require('cnd');

  rpr = CND.rpr;

  badge = 'ICQL-DBA/TESTS/BASICS';

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

  jr = JSON.stringify;

  jp = JSON.parse;

  ({lets, freeze} = require('letsfreezethat'));

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
  types.declare('dbatags_add_tag_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.dbatags_tag x.tag': function(x) {
        return this.isa.dbatags_tag(x.tag);
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
  types.declare('dbatags_tagchain_from_cid_cfg', {
    tests: {
      '@isa.object x': function(x) {
        return this.isa.object(x);
      },
      '@isa.integer x.cid': function(x) {
        return this.isa.integer(x.cid);
      }
    }
  });

  //-----------------------------------------------------------------------------------------------------------
  types.defaults = {
    dbatags_constructor_cfg: {
      dba: null,
      prefix: 't_'
    },
    dbatags_add_tag_cfg: {
      tag: null
    },
    dbatags_add_tagged_range_cfg: {
      tag: null,
      lo: null,
      hi: null
    },
    dbatags_tagchain_from_cid_cfg: {
      cid: null
    }
  };

  //===========================================================================================================
  this.Dbatags = (function() {
    class Dbatags {
      //---------------------------------------------------------------------------------------------------------
      constructor(cfg) {
        validate.dbatags_constructor_cfg(this.cfg = {...types.defaults.dbatags_constructor_cfg, ...cfg});
        if (this.cfg.dba != null) {
          this.dba = this.cfg.dba;
          delete this.cfg.dba;
        } else {
          this.dba = new (require('icql-dba')).Dba();
        }
        this.cfg = freeze(this.cfg);
        this._create_db_structure();
        this._compile_sql();
        return void 0;
      }

      //---------------------------------------------------------------------------------------------------------
      _create_db_structure() {
        var x;
        x = this.cfg.prefix;
        this.dba.execute(SQL`create table if not exists ${x}tags (
  tag   text unique not null primary key,
  value json not null default 'true' );
create table if not exists ${x}tagged_ranges (
    nr      integer primary key,
    lo      integer not null,
    hi      integer not null,
    -- chr_lo  text generated always as ( chr_from_cid( lo ) ) virtual not null,
    -- chr_hi  text generated always as ( chr_from_cid( hi ) ) virtual not null,
    mode    boolean not null,
    tag     text    not null references ${x}tags ( tag ),
    value   json    not null );
create index if not exists ${x}cidlohi_idx on ${x}tagged_ranges ( lo, hi );
create index if not exists ${x}cidhi_idx on   ${x}tagged_ranges ( hi );
create table if not exists ${x}tagged_cids_cache (
    cid     integer not null,
    -- chr     text    not null,
    tag     text    not null,
    value   json    not null,
  primary key ( cid, tag ) );`);
        return null;
      }

      //---------------------------------------------------------------------------------------------------------
      _compile_sql() {
        var x;
        x = this.cfg.prefix;
        this.sql = {
          insert_tag: SQL`insert into ${x}tags ( tag, value )
  values ( $tag, $value );`,
          // on conflict ( tag ) do nothing;"""
          insert_tagged_range: SQL`insert into ${x}tagged_ranges ( lo, hi, mode, tag, value )
  values ( $lo, $hi, $mode, $tag, $value )`,
          tags_from_cid: SQL`select
    tag,
    value
  from ${x}tagged_ranges
  where $cid between lo and hi
  order by nr asc;`
        };
        return null;
      }

      //---------------------------------------------------------------------------------------------------------
      add_tag(cfg) {
        validate.dbatags_add_tag_cfg(cfg = {...types.defaults.dbatags_add_tag_cfg, ...cfg});
        if (cfg.value == null) {
          cfg.value = true;
        }
        cfg.value = jr(cfg.value);
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
          cfg.value = true;
        }
        cfg.value = jr(cfg.value);
        this.dba.run(this.sql.insert_tagged_range, cfg);
        return null;
      }

      //---------------------------------------------------------------------------------------------------------
      tagchain_from_cid(cfg) {
        var R, ref, row;
        validate.dbatags_tagchain_from_cid_cfg(cfg = {...types.defaults.dbatags_tagchain_from_cid_cfg, ...cfg});
        R = [];
        ref = this.dba.query(this.sql.tags_from_cid, {
          cid: cfg.cid
        });
        for (row of ref) {
          R.push([row.tag, row.value]);
        }
        return R;
      }

      //---------------------------------------------------------------------------------------------------------
      tags_from_cid(cfg) {
        throw new Error('XXXXXXXXXXXXXXX');
      }

      //---------------------------------------------------------------------------------------------------------
      tags_from_tagchain(tagchain) {
        var R, i, key, len, match, mode, ref, tag_expression, value;
        validate_list_of.text(tagchain);
        R = {};
        if (tagchain.length === 0) {
          return R;
        }
        for (i = 0, len = tagchain.length; i < len; i++) {
          tag_expression = tagchain[i];
          if ((match = tag_expression.match(this.tag_pattern)) == null) {
            throw new Error(`^tags_from_tagchain@448^ tag expression not recognized: ${rpr(tag_expression)}`);
          }
          // debug '^9458^', match
          ({mode, key, value} = match.groups);
          switch (mode) {
            case '+':
              if (value == null) {
                value = true;
              } else if ((ref = value[0]) === '"' || ref === "'") {
                value = value.slice(1, value.length - 1);
              }
              R[key] = value;
              break;
            case '-':
              delete R[key];
          }
        }
        return R;
      }

    };

    //---------------------------------------------------------------------------------------------------------
    Dbatags.prototype.tag_pattern = /^(?<mode>[-+])(?<key>[a-zA-Z_\/\$][-a-zA-Z0-9_\/\$]*)(:(?<value>[^-+]+|'.*'|".*"))?$/;

    return Dbatags;

  }).call(this);

}).call(this);

//# sourceMappingURL=main.js.map