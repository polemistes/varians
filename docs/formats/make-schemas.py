#!/usr/bin/env python3
# Writes docs/formats/schemas/*.schema.json: python3 docs/formats/make-schemas.py docs/formats/schemas
import json, pathlib, sys
out = pathlib.Path(sys.argv[1])
BASE = 'https://varians.eu/formats/2/'
C = BASE + 'common.schema.json#/$defs/'
S = BASE + 'stream.schema.json#/$defs/'
def ref(d): return {'$ref': C + d}
def sref(d): return {'$ref': S + d}
def nul(t): return {'type': [t, 'null']}
NS = nul('string'); NI = nul('integer')
def obj(props, required=(), **extra):
    o = {'type': 'object', 'properties': props}
    if required: o['required'] = list(required)
    o.update(extra); return o
def arr(items): return {'type': 'array', 'items': items}
def schema(name, title, description, body, top_list=None):
    s = {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': BASE + name + '.schema.json', 'title': title, 'description': description}
    if top_list:
        key, item = top_list
        s.update(obj({'$schema': {'const': BASE + name + '.schema.json'}, key: arr(item)}, ['$schema', key]))
    else:
        s.update(body)
    (out / (name + '.schema.json')).write_text(json.dumps(s, indent=2, ensure_ascii=False) + '\n')

attrs = {'type': 'object', 'additionalProperties': {'type': ['string', 'number', 'boolean', 'null']}}
common = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': BASE + 'common.schema.json', 'title': 'Common definitions',
  'description': 'Definitions shared by the schemas of the Varians Data Format, version 2.',
  '$defs': {
    'id': {'type': 'string', 'minLength': 1, 'description': 'A record id: an opaque string, unique across installations (Varians writes ULIDs).'},
    'idOrNull': {'type': ['string', 'null'], 'minLength': 1},
    'time': {'type': 'string', 'format': 'date-time', 'description': 'ISO 8601 in UTC with milliseconds.'},
    'timeOrNull': {'type': ['string', 'null'], 'format': 'date-time'},
    'account': obj({'id': ref('id'), 'name': NS, 'since': ref('timeOrNull')}, ['id'], description='An account of the installation that wrote the archive, given for reading; accounts do not travel between installations.'),
    'identifier': obj({'scheme': {'enum': ['cts', 'diktyon', 'trismegistos', 'wikidata', 'viaf', 'url', 'other']}, 'value': {'type': 'string', 'minLength': 1}}, ['scheme', 'value']),
    'identifiers': arr(ref('identifier')),
    'spdx': {'type': ['string', 'null'], 'enum': ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', None], 'description': 'The licence of a record, as an SPDX identifier.'},
    'rights': {'type': ['string', 'null'], 'description': 'A rights statement of an image: a Creative Commons or RightsStatements.org address (specification 10.3).'},
    'visibility': {'enum': ['draft', 'published']},
    'siglumState': {'oneOf': [
      obj({'kind': {'const': 'original'}, 'siglum': {'type': 'string'}}, ['kind', 'siglum']),
      obj({'kind': {'const': 'stage'}, 'stage': {'type': 'integer'}, 'siglum': {'type': 'string'}}, ['kind', 'stage', 'siglum']),
      obj({'kind': {'const': 'hand'}, 'hand': {'type': 'string'}, 'siglum': {'type': 'string'}}, ['kind', 'hand', 'siglum']),
    ]},
    'siteKind': {'enum': ['textual', 'interpretative'], 'description': 'The kind an editor gives a place of variation, over what its letters say.'},
    'siglum': obj({'siglum': {'type': 'string'}, 'witnessId': ref('id'), 'transcriptionId': ref('idOrNull'), 'states': arr(ref('siglumState')), 'variantSiglum': NS}, ['siglum', 'witnessId']),
  },
}
(out / 'common.schema.json').write_text(json.dumps(common, indent=2, ensure_ascii=False) + '\n')

segment_start = obj({'segmentId': ref('idOrNull'), 'part': {'type': 'integer', 'minimum': 1}}, ['segmentId'])
ops = {'oneOf': [
  obj({'t': {'const': 'insert'}, 'after': ref('idOrNull'), 'items': arr(sref('item'))}, ['t', 'after', 'items']),
  obj({'t': {'const': 'delete'}, 'ids': arr(ref('id'))}, ['t', 'ids']),
  obj({'t': {'const': 'set'}, 'id': ref('id'), 'fields': {'type': 'object'}}, ['t', 'id', 'fields']),
  obj({'t': {'const': 'move'}, 'ids': arr(ref('id')), 'after': ref('idOrNull')}, ['t', 'ids', 'after']),
  obj({'t': {'const': 'split'}, 'id': ref('id'), 'at': {'type': 'integer', 'minimum': 0}, 'newId': ref('id'), 'join': {'type': 'boolean'}}, ['t', 'id', 'at', 'newId']),
  obj({'t': {'const': 'join'}, 'id': ref('id')}, ['t', 'id']),
  obj({'t': {'const': 'replace'}, 'ids': arr(ref('id')), 'items': arr(sref('item'))}, ['t', 'ids', 'items']),
]}
stream = {
  '$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': BASE + 'stream.schema.json', 'title': 'Stream',
  'description': 'The text of a transcription or an edition: an ordered list of tokens, breaks and objects, each with a permanent id (specification 4.8). Also the operations that change it (5.2).',
  'type': 'object', 'required': ['items'], 'properties': {'items': arr(sref('item'))},
  '$defs': {
    'segmentStart': segment_start,
    'mark': obj({'kind': {'type': 'string', 'minLength': 1}, 'attrs': attrs, 'from': {'type': 'integer', 'minimum': 0}, 'to': {'type': 'integer', 'minimum': 0}}, ['kind']),
    'source': {'oneOf': [
      obj({'kind': {'const': 'witness'}, 'transcriptionId': ref('id'), 'tokenIds': arr(ref('id'))}, ['kind', 'transcriptionId', 'tokenIds']),
      obj({'kind': {'const': 'conjecture'}, 'conjectureId': ref('id')}, ['kind', 'conjectureId']),
      obj({'kind': {'const': 'editor'}}, ['kind']),
    ]},
    'token': obj({'kind': {'const': 'token'}, 'id': ref('id'), 'form': {'type': 'string'}, 'lang': {'type': 'string', 'minLength': 2, 'description': 'The language of the word, a BCP 47 language tag (grc, la, cop).'}, 'norm': {'type': 'string'}, 'unchecked': {'type': 'boolean'}, 'joinNext': {'type': 'boolean'},
                  'sep': {'enum': ['space', 'none', 'interpunct', 'other']}, 'segment': sref('segmentStart'), 'marks': arr(sref('mark')), 'source': sref('source')}, ['kind', 'id', 'form', 'lang']),
    'break': obj({'kind': {'const': 'break'}, 'id': ref('id'), 'type': {'enum': ['line', 'column', 'page', 'paragraph']}, 'pageId': ref('id'), 'label': {'type': 'string'}, 'rend': {'type': 'string'}, 'lineation': {'enum': ['verse', 'prose']}}, ['kind', 'id', 'type']),
    'object': obj({'kind': {'const': 'object'}, 'id': ref('id'), 'type': {'enum': ['gap', 'figure', 'mark', 'note', 'lacuna', 'paratext', 'space']}, 'attrs': attrs, 'text': {'type': 'string'}, 'segment': sref('segmentStart')}, ['kind', 'id', 'type']),
    'item': {'oneOf': [sref('token'), sref('break'), sref('object')]},
    'op': ops,
  },
}
(out / 'stream.schema.json').write_text(json.dumps(stream, indent=2, ensure_ascii=False) + '\n')

def top(name): return {'$schema': {'const': BASE + name + '.schema.json'}}
level = obj({'key': {'type': 'string'}, 'label': {'type': 'string'}, 'type': {'type': 'string'}, 'separator': {'type': 'string'}}, ['key', 'label', 'type'])
schema('work', 'Work', 'work.json: the work and its reference scheme (specification 4.1).', obj({
  **top('work'), 'formatVersion': {'type': 'integer', 'minimum': 1}, 'id': ref('id'), 'slug': {'type': 'string', 'pattern': '^[a-z0-9-]+$'}, 'title': {'type': 'string'},
  'author': NS, 'identifier': NS, 'identifiers': ref('identifiers'), 'description': NS,
  'scheme': obj({'id': ref('id'), 'name': {'type': 'string'}, 'levels': arr(level), 'createdBy': ref('idOrNull'), 'createdAt': ref('timeOrNull')}, ['id', 'name', 'levels']),
  'maintainers': arr(ref('account')), 'licence': ref('spdx'), 'createdBy': ref('idOrNull'), 'createdAt': ref('timeOrNull')},
  ['$schema', 'formatVersion', 'id', 'slug', 'title', 'scheme']))
schema('persons', 'Persons', 'persons.json: every person the files of an archive refer to (specification 4.2).', None,
  ('persons', obj({'id': ref('id'), 'name': {'type': 'string'}, 'orcid': {'type': ['string', 'null'], 'pattern': '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'}}, ['id', 'name'])))
conj = obj({'id': ref('id'), 'workId': ref('id'), 'segmentId': ref('id'), 'segmentLabel': NS, 'kind': {'enum': ['substitution', 'deletion', 'addition', 'lacuna', 'supplement', 'transposition']},
  'lemma': {'type': 'string'}, 'reading': {'type': 'string'}, 'extent': NS, 'proposer': NS, 'note': NS, 'sequence': {'type': ['array', 'null'], 'items': ref('id')}, 'supplementsId': ref('idOrNull'),
  'anchor': {'type': ['object', 'null']}, 'ownerId': ref('id'), 'createdAt': ref('timeOrNull'), 'updatedAt': ref('timeOrNull')}, ['id', 'segmentId', 'kind', 'lemma', 'reading'])
schema('conjectures', 'Conjectures', 'conjectures.json: the conjectures on a work (specification 4.4).', None, ('conjectures', conj))
rr = obj({'id': ref('id'), 'workId': ref('id'), 'segmentId': ref('id'), 'segmentLabel': NS, 'witnessId': ref('id'), 'lemma': {'type': 'string'}, 'reading': {'type': 'string'}, 'source': NS, 'note': NS,
  'ownerId': ref('id'), 'createdAt': ref('timeOrNull'), 'updatedAt': ref('timeOrNull')}, ['id', 'segmentId', 'witnessId', 'lemma', 'reading'])
schema('reported-readings', 'Reported readings', 'reported-readings.json: readings reported for witnesses (specification 4.4).', None, ('readings', rr))
schema('bibliography', 'Bibliography', 'bibliography.json: every bibliography entry cited in an archive (specification 4.5).', None,
  ('items', obj({'id': ref('id'), 'entryType': {'type': 'string'}, 'citationKey': {'type': 'string'}, 'fields': {'type': 'object', 'additionalProperties': {'type': 'string'}}, 'label': {'type': 'string'},
                 'createdBy': ref('idOrNull'), 'createdAt': ref('timeOrNull'), 'updatedAt': ref('timeOrNull')}, ['id', 'entryType', 'citationKey', 'fields', 'label'])))
schema('citations', 'Citations', 'citations.json: which record cites which bibliography entry (specification 4.5).', None,
  ('citations', obj({'id': ref('id'), 'itemId': ref('id'), 'conjectureId': ref('idOrNull'), 'reportedReadingId': ref('idOrNull'), 'noteId': ref('idOrNull'), 'editionId': ref('idOrNull'), 'segmentId': ref('idOrNull'),
                     'prenote': NS, 'postnote': NS, 'position': {'type': 'integer'}, 'createdAt': ref('timeOrNull')}, ['id', 'itemId'])))
hand = obj({'id': {'type': 'string'}, 'label': {'type': 'string'}, 'description': NS, 'main': {'type': 'boolean'}}, ['id', 'label'])
schema('witness', 'Witness', 'witness.json: a witness of the text (specification 4.6).', obj({
  **top('witness'), 'id': ref('id'), 'slug': {'type': 'string'}, 'siglum': {'type': 'string'}, 'name': {'type': 'string'},
  'category': {'enum': ['manuscript', 'inscription', 'edition', 'indirect', 'other']}, 'format': {'enum': ['codex', 'roll', 'sheet', 'unknown', None]},
  'sourceAuthor': NS, 'sourceWork': NS, 'repository': NS, 'settlement': NS, 'shelfmark': NS, 'identifier': NS, 'identifiers': ref('identifiers'), 'dateText': NS, 'material': NS, 'extent': NS,
  'hands': arr(hand), 'provenance': NS, 'description': NS, 'iiifManifest': NS, 'imageRights': ref('rights'), 'imageAttribution': NS, 'maintainers': arr(ref('account')),
  'createdBy': ref('idOrNull'), 'createdAt': ref('timeOrNull'), 'updatedAt': ref('timeOrNull')}, ['$schema', 'id', 'slug', 'siglum', 'name', 'category']))
image = {'type': ['object', 'null'], 'properties': {'kind': {'enum': ['upload', 'iiif']}, 'path': NS, 'file': NS, 'iiif': NS, 'width': NI, 'height': NI, 'tiles': NS, 'rights': ref('rights'), 'attribution': NS, 'source': NS}, 'required': ['kind']}
schema('pages', 'Pages', 'pages.json: the pages of a witness in order, with their images (specification 4.7).', None,
  ('pages', obj({'id': ref('id'), 'label': {'type': 'string'}, 'position': {'type': 'number'}, 'image': image, 'createdAt': ref('timeOrNull')}, ['id', 'label', 'position'])))
schema('transcription', 'Transcription', 'transcription.json: a transcription of a witness, with its text (specification 4.8).', obj({
  **top('transcription'), 'id': ref('id'), 'name': {'type': 'string'}, 'witnessId': ref('id'), 'ownerId': ref('id'), 'ownerName': NS, 'visibility': ref('visibility'),
  'version': {'type': 'integer', 'minimum': 0}, 'head': ref('idOrNull'), 'keepsWrittenForm': {'type': 'boolean'}, 'displayAsWritten': {'type': 'boolean'},
  'description': NS, 'sources': NS, 'licence': NS, 'rightsNote': NS, 'createdAt': ref('timeOrNull'), 'content': {'$ref': BASE + 'stream.schema.json'}},
  ['$schema', 'id', 'name', 'witnessId', 'version', 'content']))
geometry = obj({'rect': obj({'x': {'type': 'number'}, 'y': {'type': 'number'}, 'w': {'type': 'number'}, 'h': {'type': 'number'}}, ['x', 'y', 'w', 'h']),
                'polygon': arr(obj({'x': {'type': 'number'}, 'y': {'type': 'number'}}, ['x', 'y'])), 'rotate': {'type': 'number'}})
schema('zones', 'Zones', 'zones.json: areas of page images and the tokens they show (specification 4.9).', None,
  ('zones', obj({'id': ref('id'), 'pageId': ref('id'), 'tokenIds': arr(ref('id')), 'geometry': geometry, 'feature': {'type': ['object', 'null']}, 'createdAt': ref('timeOrNull')}, ['id', 'pageId', 'tokenIds', 'geometry'])))
schema('memory', 'Normalization memory', 'memory.json: written forms with the read forms confirmed for them (specification 4.9).', None,
  ('entries', obj({'form': {'type': 'string'}, 'norm': {'type': 'string'}, 'count': {'type': 'integer', 'minimum': 0}}, ['form', 'norm'])))
schema('reviews', 'Reviews', 'reviews.json: the sites of an edition looked at, and each person\'s review position (specification 4.9).', obj({
  **top('reviews'),
  'sites': arr(obj({'segmentId': ref('id'), 'siteKey': {'type': 'string'}, 'personId': ref('idOrNull'), 'reviewedAt': ref('timeOrNull')}, ['segmentId', 'siteKey'])),
  'states': arr(obj({'personId': ref('id'), 'fromVersion': {'type': 'integer', 'minimum': 0}, 'accepted': arr(ref('id'))}, ['fromVersion', 'accepted']))}, ['$schema']))
schema('changeset', 'Changeset', 'One line of history.ndjson: a change to a document\'s text (specification 5.1). Lines carry no $schema.', obj({
  'id': ref('id'), 'parentId': ref('idOrNull'), 'merged': arr(ref('id')), 'version': NI, 'personId': ref('idOrNull'), 'at': ref('time'),
  'ops': arr(sref('op')), 'reverse': arr(sref('op')), 'message': NS}, ['id', 'at', 'ops', 'reverse']))
schema('moments', 'Moments', 'moments.json: named and published moments of a document\'s history (specification 5.4).', None,
  ('moments', obj({'id': ref('id'), 'version': {'type': 'integer', 'minimum': 0}, 'name': {'type': 'string'}, 'kind': {'enum': ['named', 'published']}, 'number': NI,
                   'basis': {'type': ['object', 'null'], 'properties': {'sigla': arr(ref('siglum')), 'versions': {'type': 'object', 'additionalProperties': {'type': 'integer'}}, 'siteKinds': arr(obj({'segmentId': ref('id'), 'siteKey': {'type': 'string'}, 'kind': ref('siteKind'), 'minor': {'const': True}}, ['segmentId', 'siteKey'], anyOf=[{'required': ['kind']}, {'required': ['minor']}]))}},
                   'personId': ref('idOrNull'), 'at': ref('time')}, ['id', 'version', 'name', 'kind', 'at'])))
schema('edition', 'Edition', 'edition.json: an edition, its conspectus, adoptions, notes and text (specification 4.10).', obj({
  **top('edition'), 'id': ref('id'), 'slug': {'type': 'string'}, 'title': {'type': 'string'}, 'editors': arr({'type': 'string'}), 'preface': NS, 'ownerId': ref('id'), 'ownerName': NS,
  'visibility': ref('visibility'), 'version': {'type': 'integer', 'minimum': 0}, 'head': ref('idOrNull'), 'publishedVersion': NI, 'conventions': {'type': 'object'}, 'copiedFrom': {'type': ['object', 'null']},
  'sources': NS, 'licence': NS, 'rightsNote': NS, 'createdAt': ref('timeOrNull'),
  'sigla': arr(ref('siglum')),
  'adoptions': arr({'oneOf': [ref('id'), obj({'conjectureId': ref('id'), 'at': ref('timeOrNull')}, ['conjectureId'])]}),
  'collaborators': arr(obj({'personId': ref('id'), 'grantedBy': ref('idOrNull'), 'since': ref('timeOrNull')})),
  'notes': arr(obj({'id': ref('id'), 'segmentId': ref('id'), 'segmentLabel': NS, 'tokenIds': arr(ref('id')), 'text': {'type': 'string'}, 'personId': ref('idOrNull'), 'createdAt': ref('timeOrNull')}, ['id', 'segmentId', 'tokenIds', 'text'])),
  'siteKinds': arr(obj({'segmentId': ref('id'), 'siteKey': {'type': 'string'}, 'kind': ref('siteKind'), 'minor': {'const': True}, 'personId': ref('idOrNull'), 'setAt': ref('timeOrNull')}, ['segmentId', 'siteKey'], anyOf=[{'required': ['kind']}, {'required': ['minor']}])),
  'content': {'$ref': BASE + 'stream.schema.json'}}, ['$schema', 'id', 'slug', 'title', 'version', 'conventions', 'sigla', 'content']))
schema('alignment', 'Alignment constraints', 'alignment.json: edition tokens an editor holds to witness tokens (specification 4.11).', None,
  ('constraints', obj({'id': ref('id'), 'segmentId': ref('id'), 'baseTokenIds': arr(ref('id')), 'transcriptionId': ref('id'), 'witnessTokenIds': arr(ref('id')), 'createdAt': ref('timeOrNull')},
                      ['id', 'segmentId', 'baseTokenIds', 'transcriptionId', 'witnessTokenIds'])))
schema('sync', 'Sync state', 'sync.json: what an installation holds of a work, for another to compare with (specification 11).', obj({
  **top('sync'), 'formatVersion': {'type': 'integer'}, 'origin': {'type': 'string'}, 'workId': ref('id'), 'licence': ref('spdx'),
  'documents': arr(obj({'id': ref('id'), 'kind': {'enum': ['transcription', 'edition']}, 'head': ref('idOrNull'), 'version': {'type': 'integer'}}, ['id', 'kind', 'head', 'version']))},
  ['$schema', 'formatVersion', 'origin', 'workId', 'documents']))
