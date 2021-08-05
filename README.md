

# ICQL DBA Tags


<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Tag Expressions (tagexes)](#tag-expressions-tagexes)
- [Usage](#usage)
  - [Instantiation](#instantiation)
- [Data Structure](#data-structure)
- [API](#api)
- [To Do](#to-do)
  - [Contiguous Ranges](#contiguous-ranges)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->


## Tag Expressions (tagexes)

* Add a tag by prefixing a tagname with a plus sign: `+fancy`, `+global`, `+web`
* Remove a tag by prefixing a tagname with a minus sign (a hyphen): `-fancy`, `-global`, `-web`. This is
  called a subtractive tag expression.
* Add a value by adding a `:` colon followed by a JSON literal: `+weight:"100kg"`
* Prefixing a value-less tagex with a minus as in `-tag` is equivalent to writing `+tag:false`, prefixing it
  with a plus as in `+tag` is equivalent to writing `+tag:true`.
* Subtractive tags cannot have explicit values, so `-tag:false` or `-tag:true` or whatever will cause an
  error.
* There is a table `t_tags` that registers all known tags alongside with their fallback values.


## Usage

### Instantiation

* `fallbacks: true`: when retrieving tags for an ID, pre-poulate the returned object with the
  tags' fallback values, but *leave out fallback values that are `false`*. The most frequent use case is
  thought to be the one where one has a fair number of tags, most of which only apply to a small-ish
  subset of IDs. One will want to set the fallback value for all these tags to `false` and associate tags
  selectively where they positively do apply. Then, when retrieving tags with `fallbacks: true`, an object
  will be returned with only the explicit tags set as keys, and the implicitly `false` ones left out. This
  being JavaScript, accessing `tags.foo` on an object `tags = { bar: true, }` will result in `undefined`,
  which is a falsey value.
* `fallbacks: 'all'`: like `fallbacks: true` but does include even those fallback values that are `false`.
  When retrieving tags with `fallbacks: 'all'`, the resulting object will always contain *all* registered
  tags with their effective values.
* `fallbacks: false`: (default) do not pre-populate the returned object of tag values.


## Data Structure

* Tags get associated with single IDs or ranges of IDs
* IDs are defined to be integers, can index anything, or stand for themselves (e.g. repreent Unicode code
  points)
* In the API, use keys `lo` and `hi` to define the first and the last ID to become associated with a tag;
  set only `lo` (and leave `hi` unset, `undefined` or `null`) to associate a tag with a single ID. This will
  be modelled by auto-setting `hi` to `lo`, resulting in a a range with a single ID.


## API

## To Do

* [ ] documentation
* [X] allow to set fallback handling at instantiation time
* [ ] consider to add table with `first_id`, `last_id` to enable
  * sanity checks on IDs passed in (i.e. must be integer and within bounds)
  * to build a cache of continuous tagged ranges tht covers all relevant IDs (Grundmenge / 'universe')
  * could also become `dba` attributes?
* [ ] restrict `prefix` setting to a small set of syntactically safe options such as `/[_a-z]+_/`

### Contiguous Ranges

The first version of `icql-dba-tags` used a per-ID cache table to avoid re-computing tags. This quickly
becomes inefficient when the number of tags / tagged ranges is low compared to the number of IDs (certainly
the case when dealing with the Unicode codespace which offers around 1e6 codepoints).

To improve this, we instead implement a caching table with *minimal contiguous ID ranges*. This table can be
computed from overlapping tagged ranges by walking through all the `lo` and `hi` endpoints of each range
(these are the 'potential inflection points' where the resulting tags for a given ID might change) and then
pruning adjacent ranges that turn out to result in the same set of tags as the previous one.

* [X] implement caching with contiguous ranges to replace caching by IDs
* [X] rewrite `tags_from_id()` to use
  * a low-level method that only uses `tagged_ranges`
  * a high-level method that ensures `contiguous_ranges` is up-to-date and uses only that table
  * use boolean attribute on `dba` to track whether refreshment of `contiguous_ranges` is up-to-date
* [X] implement 'region-wise markup' such that for a text (a sequence of IDs) we can derive a sequence
  of the same IDs interspersed with on/off signals depending on the tags of the IDs (codepoints) involved.
  The signals then can be, for example, transformed into nested HTML tags `<span class=mytag>...</span>`.

The `#{prefix}contiguous_ranges` table has to satisfy the following (partially redundant) invariants in
order to be valid:

  * All rows have fields `lo`, `hi`, and `tags`
  * If no tagged ranges are present, the table must be empty; conversely, if there are any tagged ranges,
    the table may be empty as long as `dtags._cache_filled` is `false`; otherwise, when
    `dtags._cache_filled` is `true`, the table must have at least one row.
  * There must be exactly one row whose `lo` value equals `dtags.cfg.first_id`.
  * There must be exactly one row whose `hi` value equals `dtags.cfg.last_id`.
  * In each row, both `lo` and `hi` must be integers between `dtags.cfg.first_id` and `dtags.cfg.last_id`,
    inclusively.
  * In each row, `lo` must be smaller or equal to `hi`.
  * For each row whose `lo` value is greater than `dtags.cfg.first_id`, there must be exactly one row whose
    `hi` value equals `lo - 1`.
  * For each row whose `hi` value is smaller than `dtags.cfg.last_id`, there must be exactly one row whose
    `lo` value equals `hi + 1`.
  * For each integer `id` between `dtags.cfg.first_id` and `dtags.cfg.last_id`, there is exactly one row for
    which `id` is between `lo` and `hi`, inclusively.

* [ ] improve the parts marked with `### TAINT implicit cache interaction ###` to use a less convoluted
  caching schema
  * [ ] use a key/value table to store cached values instead of putting them into instance variables


