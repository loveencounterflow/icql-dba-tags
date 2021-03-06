
'use strict'


############################################################################################################
CND                       = require 'cnd'
rpr                       = CND.rpr
badge                     = 'ICQL-DBA-TAGS'
debug                     = CND.get_logger 'debug',     badge
warn                      = CND.get_logger 'warn',      badge
info                      = CND.get_logger 'info',      badge
urge                      = CND.get_logger 'urge',      badge
help                      = CND.get_logger 'help',      badge
whisper                   = CND.get_logger 'whisper',   badge
echo                      = CND.echo.bind CND
#...........................................................................................................
types                     = new ( require 'intertype' ).Intertype
{ isa
  type_of
  validate
  validate_list_of }      = types.export()
# { to_width }              = require 'to-width'
SQL                       = String.raw
{ lets
  freeze }                = require 'letsfreezethat'
E                         = require './errors'
{ Dba, }                  = require 'icql-dba'
guy                       = require 'guy'


#===========================================================================================================
### RegEx from https://github.com/loveencounterflow/paragate/blob/master/src/htmlish.grammar.coffee with
the additional exlusion of `+`, `-`, ':' which are used in TagExes ###
name_re = /^[^-+:\s!?=\{\[\(<\/>\)\]\}'"]+$/u

#---------------------------------------------------------------------------------------------------------
### TAINT pattern does not allow for escaped quotes ###
### TAINT re-use `name_re` ###
tagex_re = ///
  ^
  (?<mode>  [ - + ] )
  (?<tag>   [ a-z A-Z _ \/ \$ ] [ - a-z A-Z 0-9 _ \/ \$ ]* )
  ( : (?<value> [^ - + ]+ | ' .* ' | " .* " ) )?
  $
  ///u


#===========================================================================================================
types.declare 'dbatags_constructor_cfg', tests:
  '@isa.object x':                ( x ) -> @isa.object x
  'x.prefix is a prefix':         ( x ) ->
    return false unless @isa.text x.prefix
    return true if x.prefix is ''
    return ( /^[_a-z][_a-z0-9]*$/ ).test x.prefix
  "x.fallbacks in [ true, false, 'all', ]": ( x ) -> x.fallbacks in [ true, false, 'all', ]
  "@isa.integer x.first_id":      ( x ) -> @isa.integer x.first_id
  "@isa.integer x.last_id":       ( x ) -> @isa.integer x.last_id
  "( @type_of x.dba ) is 'dba'":  ( x ) -> ( @type_of x.dba ) is 'dba'

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tag', tests:
  '( x.match name_re )?':       ( x ) -> ( x.match name_re )?

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_mode', tests:
  "x in [ '+', '-', ]":         ( x ) -> x in [ '+', '-', ]

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_add_tag_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.dbatags_tag x.tag':     ( x ) -> @isa.dbatags_tag x.tag
  '@isa.dbatags_mode x.mode':   ( x ) -> @isa.dbatags_mode x.mode
  'not x.nr?':                  ( x ) -> not x.nr?

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_add_tagged_range_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.integer x.lo':          ( x ) -> @isa.integer x.lo ### TAINT add boundary check ###
  '@isa.integer x.hi':          ( x ) -> @isa.integer x.hi ### TAINT add boundary check ###
  '@isa.dbatags_tag x.tag':     ( x ) -> @isa.dbatags_tag x.tag

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tagchain_from_id_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.integer x.id':          ( x ) -> @isa.integer x.id ### TAINT add boundary check ###

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tags_from_id_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.integer x.id':          ( x ) -> @isa.integer x.id ### TAINT add boundary check ###

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_parse_tagex_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.nonempty_text x.tagex': ( x ) -> @isa.nonempty_text x.tagex

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tags_from_tagchain_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.list x.tagchain':       ( x ) -> @isa.list x.tagchain

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tags_from_tagexchain_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_markup_text_cfg', tests:
  '@isa.object x':              ( x ) -> @isa.object x
  '@isa.text x.text':           ( x ) -> @isa.text x.text

#-----------------------------------------------------------------------------------------------------------
types.defaults =
  dbatags_constructor_cfg:
    dba:        null
    prefix:     't_'
    fallbacks:  false
    first_id:   0x000000
    last_id:    0x10ffff
  dbatags_add_tag_cfg:
    nr:         null
    mode:       '+'
    tag:        null
    value:      false
  dbatags_add_tagged_range_cfg:
    mode:       '+'
    tag:        null
    lo:         null
    hi:         null
    value:      null
  dbatags_parse_tagex_cfg:
    tagex:      null
  dbatags_tagchain_from_id_cfg:
    id:         null
  dbatags_tags_from_id_cfg:
    id:         null
  dbatags_tags_from_tagchain_cfg:
    tagchain:   null
  dbatags_tags_from_tagexchain_cfg:
    tagexchain: null

#===========================================================================================================
class @Dtags
  #---------------------------------------------------------------------------------------------------------
  constructor: ( cfg ) ->
    validate.dbatags_constructor_cfg @cfg = { types.defaults.dbatags_constructor_cfg..., cfg..., }
    #.......................................................................................................
    guy.props.def @, 'dba', { enumerable: false, value: @cfg.dba, }
    delete @cfg.dba
    #.......................................................................................................
    @cfg              = freeze @cfg
    @_tag_max_nr      = 0
    @_cache_filled    = false
    @_text_regions_re = null ### TAINT implicit cache interaction ###
    @_create_db_structure()
    @_compile_sql()
    @_create_sql_functions()
    return undefined

  #---------------------------------------------------------------------------------------------------------
  _create_db_structure: ->
    { prefix
      first_id
      last_id   } = @cfg
    @dba.execute SQL"""
      create table if not exists #{prefix}tags (
          nr      integer not null,
          tag     text    not null primary key,
          value   json    not null default 'true' );
      create table if not exists #{prefix}tagged_ranges (
          nr      integer not null primary key,
          lo      integer not null,
          hi      integer not null,
          mode    boolean not null,
          tag     text    not null references #{prefix}tags ( tag ),
          value   json    not null );
      create index if not exists #{prefix}tags_nr_idx on #{prefix}tags          ( nr );
      create index if not exists #{prefix}idlohi_idx on  #{prefix}tagged_ranges ( lo, hi );
      create index if not exists #{prefix}idhi_idx on    #{prefix}tagged_ranges ( hi );
      create table if not exists #{prefix}contiguous_ranges (
          lo      integer not null,
          hi      integer not null,
          tags    json    not null,
          primary key ( lo, hi ) );
      create view #{prefix}_potential_inflection_points as
        select id from ( select cast( null as integer ) as id where false
          union select #{first_id}
          union select #{last_id}
          union select distinct lo      from #{prefix}tagged_ranges
          union select distinct hi + 1  from #{prefix}tagged_ranges )
        order by id asc;
      create view #{prefix}tags_and_rangelists as
        select
          'g' || row_number() over ()     as key,
          tags                            as tags,
          #{prefix}collect_many( lo, hi ) as ranges
        from #{prefix}contiguous_ranges
        group by tags
        order by tags;
      """
    return null

  #---------------------------------------------------------------------------------------------------------
  _compile_sql: ->
    prefix = @cfg.prefix
    sql =
      insert_tag: SQL"""
        insert into #{prefix}tags ( nr, tag, value )
          values ( $nr, $tag, $value );"""
          # on conflict ( tag ) do nothing;"""
      insert_tagged_range: SQL"""
        insert into #{prefix}tagged_ranges ( lo, hi, mode, tag, value )
          values ( $lo, $hi, $mode, $tag, $value )"""
      insert_contiguous_range: SQL"""
        insert into #{prefix}contiguous_ranges ( lo, hi, tags )
          values ( $lo, $hi, $tags )"""
      tagchain_from_id: SQL"""
        select
            nr,
            mode,
            tag,
            value
          from #{prefix}tagged_ranges
          where $id between lo and hi
          order by nr asc;"""
      cached_tags_from_id: SQL"""
        select
            tags
          from #{prefix}contiguous_ranges
          where $id between lo and hi
          limit 1;"""
      get_fallbacks: SQL"""
        select * from #{prefix}tags
          order by nr;"""
      potential_inflection_points: SQL"""
        select id from #{prefix}_potential_inflection_points;"""
      truncate_contiguous_ranges: SQL"""
        delete from #{prefix}contiguous_ranges;"""
      get_contiguous_ranges: SQL"""
        select * from #{prefix}contiguous_ranges order by lo, hi, tags;"""
      get_tagged_ranges: SQL"""
        select nr, lo, hi, mode, tag, value
        from #{@cfg.prefix}tagged_ranges
        order by nr;"""
      get_tags_and_rangelists: SQL"""
        select key, tags, ranges
        from #{@cfg.prefix}tags_and_rangelists
        order by key;"""
    guy.props.def @, 'sql', { enumerable: false, value: sql, }
    return null

  #---------------------------------------------------------------------------------------------------------
  _create_sql_functions: ->
    prefix  = @cfg.prefix
    @f      = {}
    # #.......................................................................................................
    # @dba.create_function
    #   name:           "#{prefix}_tags_from_id",
    #   deterministic:  true,
    #   varargs:        false,
    #   call:           ( id ) =>
    #     fallbacks = @get_filtered_fallbacks()
    #     tagchain  = @tagchain_from_id { id, }
    #     tags      = @tags_from_tagchain { tagchain, }
    #     return JSON.stringify { fallbacks..., tags..., }
    #.......................................................................................................
    ### TAINT put these into separate module like `icql-dba-standard` ###
    @dba.create_window_function
      name:           prefix + 'collect'
      varargs:        false
      start:          -> []
      step:           ( total, element ) -> total.push element; total
      inverse:        ( total, dropped ) -> total.pop(); total
      result:         ( total ) -> JSON.stringify total
    #.......................................................................................................
    @dba.create_window_function
      name:           prefix + 'collect_many'
      varargs:        true
      start:          -> []
      step:           ( total, elements... ) -> total.push elements; total
      inverse:        ( total, dropped ) -> total.pop(); total
      result:         ( total ) -> JSON.stringify total
    #.......................................................................................................
    @f.cid_from_chr = ( chr ) -> chr.codePointAt 0
    @f.chr_from_cid = ( cid ) -> String.fromCodePoint cid
    @f.to_hex       = ( cid ) -> '0x' + cid.toString 16
    @dba.create_function name: 'chr_from_cid', call: @f.chr_from_cid
    @dba.create_function name: 'cid_from_chr', call: @f.cid_from_chr
    @dba.create_function name: 'to_hex',       call: @f.to_hex
    #.......................................................................................................
    return null

  #---------------------------------------------------------------------------------------------------------
  add_tag: ( cfg ) ->
    validate.dbatags_add_tag_cfg cfg = { types.defaults.dbatags_add_tag_cfg..., cfg..., }
    cfg.value ?= true
    cfg.value  = JSON.stringify cfg.value
    @_tag_max_nr++
    cfg.nr     = @_tag_max_nr
    @dba.run @sql.insert_tag, cfg
    return null

  #---------------------------------------------------------------------------------------------------------
  add_tagged_range: ( cfg ) ->
    validate.dbatags_add_tagged_range_cfg cfg = { types.defaults.dbatags_add_tagged_range_cfg..., cfg..., }
    cfg.value ?= if cfg.mode is '+' then true else false
    cfg.value  = JSON.stringify cfg.value
    @_on_add_tagged_range()
    @dba.run @sql.insert_tagged_range, cfg
    return null

  #---------------------------------------------------------------------------------------------------------
  tagchain_from_id: ( cfg ) ->
    validate.dbatags_tagchain_from_id_cfg cfg = { types.defaults.dbatags_tagchain_from_id_cfg..., cfg..., }
    R = []
    for row from @dba.query @sql.tagchain_from_id, cfg
      row.value = JSON.parse row.value
      R.push row
    return R

  #---------------------------------------------------------------------------------------------------------
  _tags_from_id_uncached: ( cfg ) ->
    validate.dbatags_tags_from_id_cfg cfg = { types.defaults.dbatags_tags_from_id_cfg..., cfg..., }
    { id, } = cfg
    R       = @get_filtered_fallbacks()
    Object.assign R, @tags_from_tagchain { tagchain: ( @tagchain_from_id cfg ), }
    return R

  #---------------------------------------------------------------------------------------------------------
  tags_from_id: ( cfg ) ->
    ### TAINT implicit cache interaction ###
    @_create_minimal_contiguous_ranges() unless @_cache_filled
    validate.dbatags_tags_from_id_cfg cfg = { types.defaults.dbatags_tags_from_id_cfg..., cfg..., }
    return JSON.parse @dba.first_value @dba.query @sql.cached_tags_from_id, cfg
    return R

  #---------------------------------------------------------------------------------------------------------
  parse_tagex: ( cfg ) ->
    validate.dbatags_parse_tagex_cfg cfg = { types.defaults.dbatags_parse_tagex_cfg..., cfg..., }
    { tagex, } = cfg
    unless ( match = tagex.match tagex_re )?
      throw new E.Dtags_invalid_tagex '^dtags@777^', tagex
    { mode, tag, value, }   = match.groups
    switch mode
      when '+'
        value ?= 'true'
      when '-'
        if value?
          throw new E.Dtags_subtractive_value '^dtags@778^', tagex
        value = 'false'
    try value = JSON.parse value catch error
      throw new E.Dtags_illegal_tagex_value_literal '^dtags@779^', tagex, error.message
    return { mode, tag, value, }

  #---------------------------------------------------------------------------------------------------------
  tags_from_tagchain: ( cfg ) ->
    ### TAINT make deletion bahvior configurable ###
    ### TAINT allow to seed result with fallbacks ###
    validate.dbatags_tags_from_tagchain_cfg cfg = { types.defaults.dbatags_tags_from_tagchain_cfg..., cfg..., }
    R             = {}
    { tagchain, } = cfg
    return R if tagchain.length is 0
    for tag in tagchain
      { mode, tag, value, } = tag
      switch mode
        when '+' then R[ tag ] = value
        when '-' then delete R[ tag ]
        # when '-' then R[ tag ] = value
        else throw new E.Dtags_unexpected '^dtags@780^', "unknown tag mode in #{rpr tag}"
    return R

  #---------------------------------------------------------------------------------------------------------
  tags_from_tagexchain: ( cfg ) ->
    validate.dbatags_tags_from_tagexchain_cfg cfg = { types.defaults.dbatags_tags_from_tagexchain_cfg..., cfg..., }
    tagchain = ( ( @parse_tagex { tagex, } ) for tagex in cfg.tagexchain )
    return @tags_from_tagchain { tagchain, }


  #=========================================================================================================
  # TAGGED TEXT REGIONS
  #---------------------------------------------------------------------------------------------------------
  _on_add_tagged_range: ->
    ### TAINT implicit cache interaction ###
    @dba.execute @sql.truncate_contiguous_ranges
    @_text_regions_re = null ### TAINT mark cached value or collect in `@cache` ###
    @_cache_filled    = false
    return null

  #---------------------------------------------------------------------------------------------------------
  _create_minimal_contiguous_ranges: ->
    ### Iterate over all potential inflection points (the boundaries of all tagged ranges) to find at which
    points an actual change in the tagset occurs; these endpoints are then (together with the tagsets)
    inserted into table `t_contiguous_ranges`. ###
    @_on_add_tagged_range() ### TAINT implicit cache interaction ###
    pi_ids        = ( row.id for row from @dba.query @sql.potential_inflection_points )
    last_idx      = pi_ids.length - 1
    last_id       = pi_ids[ last_idx ]
    prv_tags      = null
    ids_and_tags  = []
    #.......................................................................................................
    for idx in [ 0 ... pi_ids.length - 1 ]
      id    = pi_ids[ idx ]
      tags  = JSON.stringify @_tags_from_id_uncached { id, }
      continue if tags is prv_tags
      prv_tags  = tags
      ids_and_tags.push { id, tags, }
    ids_and_tags.push { id: last_id, tags: null, }
    #.......................................................................................................
    for idx in [ 0 ... ids_and_tags.length - 1 ]
      entry = ids_and_tags[ idx ]
      lo    = entry.id
      hi    = ids_and_tags[ idx + 1 ].id - 1
      tags  = entry.tags
      @dba.run @sql.insert_contiguous_range, { lo, hi, tags, }
    #.......................................................................................................
    @_cache_filled = true ### TAINT implicit cache interaction ###
    return null

  #---------------------------------------------------------------------------------------------------------
  _regex_chr_class_from_range: ( range ) ->
    ### TAINT make addition of spaces configurable, e.g. as `all_groups_extra: '\\s'`  ###
    [ lo, hi, ] = range
    return "\\u{#{lo.toString 16}}" if lo is hi
    return "\\u{#{lo.toString 16}}-\\u{#{hi.toString 16}}"

  #---------------------------------------------------------------------------------------------------------
  get_tagsets_by_keys: ->
    @_create_minimal_contiguous_ranges() unless @_cache_filled ### TAINT implicit cache interaction ###
    R = {}
    for { key, tags, } from @dba.query SQL"select * from #{@cfg.prefix}tags_and_rangelists;"
      R[ key ] = JSON.parse tags
    return R

  #---------------------------------------------------------------------------------------------------------
  _build_text_regions_re: ->
    parts = []
    for { key, tags, ranges, } from @dba.query SQL"select * from #{@cfg.prefix}tags_and_rangelists;"
      ranges = JSON.parse ranges
      ranges = ( ( @_regex_chr_class_from_range range ) for range in ranges ).join ''
      parts.push "(?<#{key}>[#{ranges}]+)"
    parts = parts.join '|'
    return @_text_regions_re = new RegExp parts, 'gu'

  #---------------------------------------------------------------------------------------------------------
  find_tagged_regions: ( text ) ->
    ### TAINT use `cfg` ###
    ### TAINT may want to use new `/.../d` flag when it becomes available ###
    re    = @_text_regions_re ? @_build_text_regions_re() ### TAINT implicit cache interaction ###
    # debug '^33436^', re
    R     = []
    stop  = 0
    #.......................................................................................................
    for match from text.matchAll re
      { index: start, } = match
      for key, part of match.groups
        break if part?
      if start > stop
        part      = text[ stop ... start ]
        # warn stop, start, CND.reverse rpr part
        new_stop  = start + part.length
        R.push { key: 'missing', start: stop, stop: new_stop, part, }
        stop      = new_stop
        continue
      #.....................................................................................................
      stop += part.length
      # info start, stop, key, rpr part
      R.push { key, start, stop, part, }
    #.......................................................................................................
    return R

  #---------------------------------------------------------------------------------------------------------
  _markup_text: ( cfg ) ->
    validate.dbatags_markup_text_cfg cfg = { types.defaults.dbatags_markup_text_cfg..., cfg..., }
    R         = []
    { text, } = cfg
    tagsets   = @get_tagsets_by_keys()
    for region in regions = @find_tagged_regions text
      region.tags = tagsets[ region.key ]
      R.push region
    return R

  #=========================================================================================================
  # TABLE GETTERS
  #---------------------------------------------------------------------------------------------------------
  get_tags: ->
    R   = {}
    sql = SQL"select nr, tag, value as fallback from #{@cfg.prefix}tags order by nr;"
    for { nr, tag, fallback, } from @dba.query sql
      fallback  = JSON.parse fallback
      R[ tag ]  = { nr, fallback, }
    return R

  #---------------------------------------------------------------------------------------------------------
  get_tagged_ranges: ->
    R = []
    for { nr, lo, hi, mode, tag, value, } from @dba.query @sql.get_tagged_ranges
      value = JSON.parse value
      R.push { nr, lo, hi, mode, tag, value, }
    return R

  #---------------------------------------------------------------------------------------------------------
  get_filtered_fallbacks: ->
    return {} if @cfg.fallbacks is false
    R = @get_fallbacks()
    return R if @cfg.fallbacks is 'all'
    for tag, value of R
      delete R[ tag ] if value is false
    return R

  #---------------------------------------------------------------------------------------------------------
  get_fallbacks: ->
    R = {}
    for row from @dba.query @sql.get_fallbacks
      R[ row.tag ] = JSON.parse row.value
    return R

  #---------------------------------------------------------------------------------------------------------
  get_continuous_ranges: ( cfg ) ->
    ### TAINT implicit cache interaction ###
    @_create_minimal_contiguous_ranges() unless @_cache_filled
    R = []
    for { lo, hi, tags, } from @dba.query @sql.get_contiguous_ranges
      tags = JSON.parse tags
      R.push { lo, hi, tags, }
    return R

  #---------------------------------------------------------------------------------------------------------
  get_tags_and_rangelists: ( cfg ) ->
    ### TAINT implicit cache interaction ###
    @_create_minimal_contiguous_ranges() unless @_cache_filled
    R = []
    for { key, tags, ranges, } from @dba.query @sql.get_tags_and_rangelists
      tags    = JSON.parse tags
      ranges  = JSON.parse ranges
      R.push { key, tags, ranges, }
    return R

