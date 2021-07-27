
'use strict'


############################################################################################################
CND                       = require 'cnd'
rpr                       = CND.rpr
badge                     = 'ICQL-DBA/TESTS/BASICS'
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
jr                        = JSON.stringify
jp                        = JSON.parse
{ lets
  freeze }                = require 'letsfreezethat'


#===========================================================================================================
types.declare 'dbatags_constructor_cfg', tests:
  '@isa.object x':        ( x ) -> @isa.object x
  'x.prefix is a prefix': ( x ) ->
    return false unless @isa.text x.prefix
    return true if x.prefix is ''
    return ( /^[_a-z][_a-z0-9]*$/ ).test x.prefix

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tag', tests:
  '@isa.nonempty_text x': ( x ) -> @isa.nonempty_text x

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_add_tag_cfg', tests:
  '@isa.object x':            ( x ) -> @isa.object x
  '@isa.dbatags_tag x.tag':   ( x ) -> @isa.dbatags_tag x.tag

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_add_tagged_range_cfg', tests:
  '@isa.object x':            ( x ) -> @isa.object x
  '@isa.integer x.lo':        ( x ) -> @isa.integer x.lo
  '@isa.integer x.hi':        ( x ) -> @isa.integer x.hi
  '@isa.dbatags_tag x.tag':   ( x ) -> @isa.dbatags_tag x.tag

#-----------------------------------------------------------------------------------------------------------
types.declare 'dbatags_tagchain_from_cid_cfg', tests:
  '@isa.object x':            ( x ) -> @isa.object x
  '@isa.integer x.cid':       ( x ) -> @isa.integer x.cid

#-----------------------------------------------------------------------------------------------------------
types.defaults =
  dbatags_constructor_cfg:
    dba:        null
    prefix:     't_'
  dbatags_add_tag_cfg:
    tag:        null
  dbatags_add_tagged_range_cfg:
    tag:        null
    lo:         null
    hi:         null
  dbatags_tagchain_from_cid_cfg:
    cid:        null

#===========================================================================================================
class @Dbatags
  #---------------------------------------------------------------------------------------------------------
  constructor: ( cfg ) ->
    validate.dbatags_constructor_cfg @cfg = { types.defaults.dbatags_constructor_cfg..., cfg..., }
    if @cfg.dba?
      @dba  = @cfg.dba
      delete @cfg.dba
    else
      @dba  = new ( require 'icql-dba' ).Dba()
    @cfg = freeze @cfg
    @_create_db_structure()
    @_compile_sql()
    return undefined

  #---------------------------------------------------------------------------------------------------------
  _create_db_structure: ->
    x = @cfg.prefix
    @dba.execute SQL"""
      create table if not exists #{x}tags (
        tag   text unique not null primary key,
        value json not null default 'true' );
      create table if not exists #{x}tagged_ranges (
          nr      integer primary key,
          lo      integer not null,
          hi      integer not null,
          -- chr_lo  text generated always as ( chr_from_cid( lo ) ) virtual not null,
          -- chr_hi  text generated always as ( chr_from_cid( hi ) ) virtual not null,
          mode    boolean not null,
          tag     text    not null references #{x}tags ( tag ),
          value   json    not null );
      create index if not exists #{x}cidlohi_idx on #{x}tagged_ranges ( lo, hi );
      create index if not exists #{x}cidhi_idx on   #{x}tagged_ranges ( hi );
      create table if not exists #{x}tagged_cids_cache (
          cid     integer not null,
          -- chr     text    not null,
          tag     text    not null,
          value   json    not null,
        primary key ( cid, tag ) );
      """
    return null

  #---------------------------------------------------------------------------------------------------------
  _compile_sql: ->
    x = @cfg.prefix
    @sql =
      insert_tag: SQL"""
        insert into #{x}tags ( tag, value )
          values ( $tag, $value );"""
          # on conflict ( tag ) do nothing;"""
      insert_tagged_range: SQL"""
        insert into #{x}tagged_ranges ( lo, hi, mode, tag, value )
          values ( $lo, $hi, $mode, $tag, $value )"""
      tags_from_cid: SQL"""
        select
            tag,
            value
          from #{x}tagged_ranges
          where $cid between lo and hi
          order by nr asc;"""
    return null

  #---------------------------------------------------------------------------------------------------------
  add_tag: ( cfg ) ->
    validate.dbatags_add_tag_cfg cfg = { types.defaults.dbatags_add_tag_cfg..., cfg..., }
    cfg.value ?= true
    cfg.value  = jr cfg.value
    @dba.run @sql.insert_tag, cfg
    @_clear_cache_for_range cfg
    return null

  #---------------------------------------------------------------------------------------------------------
  _clear_cache_for_range: ( cfg ) ->

  #---------------------------------------------------------------------------------------------------------
  add_tagged_range: ( cfg ) ->
    validate.dbatags_add_tagged_range_cfg cfg = { types.defaults.dbatags_add_tagged_range_cfg..., cfg..., }
    cfg.value ?= true
    cfg.value  = jr cfg.value
    @dba.run @sql.insert_tagged_range, cfg
    return null

  #---------------------------------------------------------------------------------------------------------
  tagchain_from_cid: ( cfg ) ->
    validate.dbatags_tagchain_from_cid_cfg cfg = { types.defaults.dbatags_tagchain_from_cid_cfg..., cfg..., }
    R   = []
    R.push [ row.tag, row.value, ] for row from @dba.query @sql.tags_from_cid, { cid: cfg.cid, }
    return R

  #---------------------------------------------------------------------------------------------------------
  tags_from_cid: ( cfg ) ->
    throw new Error 'XXXXXXXXXXXXXXX'

  #---------------------------------------------------------------------------------------------------------
  tag_pattern: ///
    ^
    (?<mode>  [ - + ] )
    (?<key>   [ a-z A-Z _ \/ \$ ] [ - a-z A-Z 0-9 _ \/ \$ ]* )
    ( : (?<value> [^ - + ]+ | ' .* ' | " .* " ) )?
    $
    ///

  #---------------------------------------------------------------------------------------------------------
  tags_from_tagchain: ( tagchain ) ->
    validate_list_of.text tagchain
    R = {}
    return R if tagchain.length is 0
    for tag_expression in tagchain
      unless ( match = tag_expression.match @tag_pattern )?
        throw new Error "^tags_from_tagchain@448^ tag expression not recognized: #{rpr tag_expression}"
      # debug '^9458^', match
      { mode, key, value, }   = match.groups
      switch mode
        when '+'
          unless value?                       then value = true
          else if value[ 0 ] in [ '"', "'", ] then value = value[ 1 ... value.length - 1 ]
          R[ key ] = value
        when '-'
          delete R[ key ]
    return R


