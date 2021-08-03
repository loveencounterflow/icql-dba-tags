
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


#===========================================================================================================
types.declare 'dbatags_constructor_cfg', tests:
  '@isa.object x':        ( x ) -> @isa.object x
  'x.prefix is a prefix': ( x ) ->
    return false unless @isa.text x.prefix
    return true if x.prefix is ''
    return ( /^[_a-z][_a-z0-9]*$/ ).test x.prefix
  "x.fallbacks in [ true, false, 'all', ]": ( x ) -> x.fallbacks in [ true, false, 'all', ]
  "@isa.integer x.first_id":  ( x ) -> @isa.integer x.first_id
  "@isa.integer x.last_id":   ( x ) -> @isa.integer x.last_id

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tag', tests:
  '@isa.nonempty_text x':       ( x ) -> @isa.nonempty_text x

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
    if @cfg.dba?
      @dba  = @cfg.dba
      delete @cfg.dba
    else
      @dba  = new Dba()
    #.......................................................................................................
    @cfg          = freeze @cfg
    @_tag_max_nr  = 0
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
      create table if not exists #{prefix}tagged_ids_cache (
          id      integer not null primary key,
          tags    json    not null );
      create table if not exists #{prefix}contiguous_ranges (
          lo      integer not null,
          hi      integer not null,
          tags    json    not null,
          primary key ( lo, hi ) );
      create view #{prefix}_potential_inflection_points as
        select id from ( select cast( null as integer ) as id where false
          union select #{first_id}
          union select #{last_id}
          union select distinct lo      from t_tagged_ranges
          union select distinct hi + 1  from t_tagged_ranges )
        order by id asc;
      """
    return null

  #---------------------------------------------------------------------------------------------------------
  _compile_sql: ->
    prefix = @cfg.prefix
    @sql =
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
          from #{prefix}tagged_ids_cache
          where id = $id;"""
      insert_cached_tags: SQL"""
        insert into #{prefix}tagged_ids_cache ( id, tags )
          values ( $id, $tags );"""
      get_fallbacks: SQL"""
        select * from #{prefix}tags
          order by nr;"""
      potential_inflection_points: SQL"""
        select id from #{prefix}_potential_inflection_points;"""
      truncate_contiguous_ranges: SQL"""
        delete from #{prefix}contiguous_ranges;"""
    return null

  #---------------------------------------------------------------------------------------------------------
  _create_sql_functions: ->
    # prefix = @cfg.prefix
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
  create_minimal_contiguous_ranges: ->
    pi_ids        = ( row.id for row from @dba.query @sql.potential_inflection_points )
    last_idx      = pi_ids.length - 1
    last_id       = pi_ids[ last_idx ]
    prv_tags      = null
    ids_and_tags  = []
    #.......................................................................................................
    # debug '^3337^', id, rpr pi_ids
    for idx in [ 0 ... pi_ids.length - 1 ]
      id    = pi_ids[ idx ]
      tags  = JSON.stringify @tags_from_id { id, }
      continue if tags is prv_tags
      # nxt_id    = pi_ids[ idx + 1 ] - 1
      prv_tags  = tags
      # debug '^3337^', id, nxt_id, rpr tags
      # debug '^3337^', id, rpr tags
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
    return null

  #---------------------------------------------------------------------------------------------------------
  _on_add_tagged_range: ->
    @dba.execute @sql.truncate_contiguous_ranges
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
  tagchain_from_id: ( cfg ) ->
    validate.dbatags_tagchain_from_id_cfg cfg = { types.defaults.dbatags_tagchain_from_id_cfg..., cfg..., }
    R = []
    for row from @dba.query @sql.tagchain_from_id, cfg
      row.value = JSON.parse row.value
      R.push row
    return R

  #---------------------------------------------------------------------------------------------------------
  tags_from_id: ( cfg ) ->
    validate.dbatags_tags_from_id_cfg cfg = { types.defaults.dbatags_tags_from_id_cfg..., cfg..., }
    { id, } = cfg
    R       = [ ( @dba.query @sql.cached_tags_from_id, cfg )..., ]
    return JSON.parse R[ 0 ].tags if R.length > 0
    R       = @get_filtered_fallbacks()
    Object.assign R, @tags_from_tagchain { tagchain: ( @tagchain_from_id cfg ), }
    @dba.run @sql.insert_cached_tags, { id, tags: ( JSON.stringify R ), }
    return R

  #---------------------------------------------------------------------------------------------------------
  ### TAINT pattern does not allow for escaped quotes ###
  tagex_pattern: ///
    ^
    (?<mode>  [ - + ] )
    (?<tag>   [ a-z A-Z _ \/ \$ ] [ - a-z A-Z 0-9 _ \/ \$ ]* )
    ( : (?<value> [^ - + ]+ | ' .* ' | " .* " ) )?
    $
    ///

  #---------------------------------------------------------------------------------------------------------
  parse_tagex: ( cfg ) ->
    validate.dbatags_parse_tagex_cfg cfg = { types.defaults.dbatags_parse_tagex_cfg..., cfg..., }
    { tagex, } = cfg
    unless ( match = tagex.match @tagex_pattern )?
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



