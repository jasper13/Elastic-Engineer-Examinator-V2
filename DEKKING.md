# Objective-dekking

De meegeleverde vragenbank (26 vragen) dekt alle officiele Elastic Certified
Engineer objectives. Per objective is er minstens een vraag.

## Data Management
- Define an index that satisfies requirements -> "Define an index from requirements"
- Dynamic template -> "Dynamic template"
- ILM policy for a time-series index -> "ILM policy for a time-series index"
- Index template that creates a data stream -> "Index template that creates a data stream"

## Searching Data
- Terms/phrases search -> "Search for terms and phrases"
- Boolean combination of queries/filters -> "Boolean combination of queries and filters"
- Asynchronous search -> "Asynchronous search"
- Metric and bucket aggregations -> "Metric and bucket aggregations"
- Sub-aggregations -> "Aggregations with sub-aggregations"
- Cross-cluster search -> "Cross-cluster search"
- Runtime field in search -> "Search using a runtime field"

## Developing Search Applications
- Sort results -> "Sort query results"
- Pagination -> "Paginate search results"
- Index aliases -> "Define and use index aliases"

## Data Processing
- Mapping from requirements -> "Define a mapping from requirements"
- Multi-fields -> "Multi-fields with different types/analyzers"
- Reindex + Update By Query -> "Reindex and Update By Query"
- Ingest pipeline -> "Ingest pipeline from requirements"
- Runtime fields via Painless -> "Runtime field via Painless in the mapping"

## Cluster Management
- Diagnose/repair shard issues -> "Diagnose and repair shard issues"
- Backup and restore -> "Register a repository and take a snapshot" + "Restore an index from a snapshot"
- Searchable snapshot -> "Configure a searchable snapshot"
- Cross-cluster search config -> "Configure cross-cluster search"
- Cross-cluster replication -> "Implement cross-cluster replication"
- SLM -> "Automate snapshots with SLM"

## Let op (single-node dev cluster)
Objectives die normaal een tweede cluster of extra infra nodig hebben
(cross-cluster search/replication, searchable snapshots, restore) verifieren
de *configuratie* die je aanmaakt, zodat ze ook op een single node slagen.

- Snapshot-vragen vereisen een `path.repo` in `elasticsearch.yml` voor een fs-repository.
- Cross-cluster vragen gebruiken seed `127.0.0.1:9300` (je eigen node) zodat de
  remote-registratie lukt zonder tweede cluster.
- Security-acties (indien toegevoegd) vereisen inloggen als een gebruiker die
  security mag beheren.
