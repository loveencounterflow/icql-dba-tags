'use strict'


############################################################################################################
CND                       = require 'cnd'
rpr                       = CND.rpr
badge                     = 'ICQL-DBA/ERRORS'
debug                     = CND.get_logger 'debug',     badge
# warn                      = CND.get_logger 'warn',      badge
# info                      = CND.get_logger 'info',      badge
# urge                      = CND.get_logger 'urge',      badge
# help                      = CND.get_logger 'help',      badge
# whisper                   = CND.get_logger 'whisper',   badge
# echo                      = CND.echo.bind CND

E                         = require 'icql-dba/lib/errors'

#===========================================================================================================
class @Dtags_invalid_tagex extends E.Dba_error
  constructor: ( ref, tagex )      -> super ref, "invalid tag expression #{rpr tagex}"
class @Dtags_subtractive_value extends E.Dba_error
  constructor: ( ref, tagex )      -> super ref, "subtractive tag expression cannot have value, got #{rpr tagex}"
class @Dtags_illegal_tagex_value_literal extends E.Dba_error
  constructor: ( ref, tagex, message )      -> super ref, "unable to parse value part of #{rpr tagex} (#{message})"
class @Dtags_unexpected extends E.Dba_error
  constructor: ( ref, message )      -> super ref, message
