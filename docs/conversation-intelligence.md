# Conversation Intelligence

What people asked the assistants, whether they got an answer, and what the
knowledge base is missing.

## Why this exists

Every other feature in this codebase produces conversations. Nothing consumed
them. `conversations` and `messages` have held the complete record since
migration 0005, and the only way to answer *"is this thing working, and what
should I feed it next?"* was to read a thousand transcripts by hand.

That question is the one a buyer asks on day thirty, and it is the one the
platform is uniquely able to answer, because it owns the transcripts. A CRM
does not compete for it. Neither does an analytics page counting messages per
chatbot: volume says the assistant was used, not that it was useful.

The audit that led here found the CRM had no recorded rationale anywhere in the
repository - no ADR, no evaluation, nothing but a line in the README - while
every other significant decision had one. This document exists so that the same
cannot be said of this feature.

## What phase 1 does

1. **Derives per-conversation signals.** For each conversation in the window:
   the opening question, how many turns the person took, whether any assistant
   reply cited a knowledge source, and how the thread ended.
2. **Clusters the questions into topics.** Each question is embedded and
   assigned to the nearest existing topic, or founds a new one.
3. **Names each topic** with one model call, from the questions inside it.
4. **Ranks topics by knowledge gap** - volume weighted by how much of it went
   unanswered - so the list answers "which article should I write on Monday".
5. **Drafts that article**, filing the skeleton into the knowledge base.

Everything is on demand. A run is started from the Intelligence page and the
caller waits, which is the precedent `processSource` set for knowledge
ingestion: there is no job runner in this codebase, and a single feature is the
wrong place to introduce one.

## The metrics, and the one definition that matters

| Metric | Definition |
| --- | --- |
| **Contained** | Resolved with no reply from a team member. |
| **Handed off** | A team member replied in the thread. |
| **Escalated** | Marked escalated, nobody has answered yet. |
| **Unresolved** | Still open, untouched. |
| **Coverage** | At least one assistant reply cited a knowledge source. |

**A human reply outranks the status column, and that ordering is the whole
point.** A thread where somebody stepped in and then marked it resolved is a
success for the team and a failure for the assistant. Counting it as contained
because of the status would make the reported deflection rate a measurement of
inbox hygiene. What the assistant did is a fact about the messages, so it is
read from the messages — `deriveOutcome` in `metrics.ts`, asserted in
`tests/unit/intelligence-metrics.test.ts`.

**Coverage is grounding, not sentiment.** `messages.sources` is written by
retrieval, not inferred afterwards, so it is the one signal here that cannot be
argued with. A reply with no sources is one the model produced from its own
weights: the answer nobody can verify and nobody can correct.

Every rate is derived from stored counts, never persisted. There is one
definition of containment and the topic row cannot disagree with the workspace
rollup about it. The gap score even reduces to the same expression in both
places — `count × (1 − grounded/count)` is `count − grounded`, which is what the
repository sorts by and what `knowledgeGapScore` returns.

## Why the derived data gets its own tables

`conversation_insights`, `conversation_topics` and `conversation_analysis_runs`
(migration 0027). Computing this per page render does not survive a demo:
grounding is a property of every message in a thread, clustering is
O(conversations × topics) over vectors, and a topic label costs a model call.

Nothing in those tables is a source of truth. Every column is recomputable from
`conversations` and `messages`, so the whole set is safe to truncate and
rebuild. Counters are recomputed wholesale at the end of a run rather than
incremented along the way — incrementing is faster and wrong in the way that
matters, because a run that fails halfway leaves counters that no longer
describe any set of rows and nothing afterwards can tell they are skewed.

`conversation_analysis_runs` exists so the page can say how old its numbers are.
A dashboard that looks live while showing last week's figures is the same
dishonesty as a workflow diagram implying a step executed.

## Clustering: why leader clustering, not k-means

Single-pass nearest-centroid assignment. Compare each question to every
centroid, join the best above a threshold, otherwise found a topic.

k-means would produce tidier clusters and is the wrong tool. It needs k up
front, it is not stable across runs, and re-running it reshuffles every topic
id. **Stability is worth more than cluster quality when the output is a list
somebody reads every week** — a topic a customer has been watching must not
silently become a different topic overnight.

The cost is order sensitivity: the first question to raise a subject founds its
topic. That is why the read model returns conversations oldest first.

At `MAX_TOPICS_PER_WORKSPACE` a question that matches nothing is forced into its
nearest topic rather than dropped, and `topic_similarity` records how weak the
match was. Dropping it would make every conversation count quietly wrong; a
slightly wrong topic is more useful than five hundred topics of one.

## The threshold is measured, and it is the weakest part of this

> `TOPIC_SIMILARITY_THRESHOLD = 0.3`, measured rather than guessed.

`MockEmbeddingProvider` is a feature-hashing encoder, so similarity is shared
vocabulary and nothing else. Measured across the seeded demo questions:

| Pair kind | median | max |
| --- | --- | --- |
| Same subject, different wording | 0.158 | 0.516 |
| Different subjects | 0.000 | 0.154 |

**The two distributions barely separate, and they overlap.** "We need SSO before
we can roll this out" and "Is single sign on supported anywhere" share no
content word and score **0.000**. No threshold groups those, because the encoder
cannot see they are the same question.

The first guess was 0.6, chosen from intuition. Run against 31 seeded
conversations it produced **27 topics** — it grouped essentially nothing, while
the comment next to it claimed it was "permissive enough to group genuine
rephrasings". Sweeping it against real data:

| Threshold | Topics | Partly mixed |
| --- | --- | --- |
| 0.6 | 27 | 0 (nothing merged at all) |
| 0.45 | 21 | — |
| 0.3 | **14** | **2** |
| 0.25 | 11 | 2, one badly |
| 0.2 | 9 | 3, incl. SSO fused with refunds |

0.3 is the best of a bad set of options: it clears the 0.154 ceiling on
unrelated pairs with margin, and leader clustering does better than the pairwise
numbers suggest because a growing centroid accumulates the subject's vocabulary.
Two topics still end up partly mixed at 0.3. That is the floor for a lexical
encoder, not a bug in the clustering.

**This must be re-measured when a hosted embedding provider is wired in, and it
will be much higher** — a real model puts paraphrases above 0.85. It is a
property of the vector space, not a preference.

`conversation_topics.embedding_config` exists for the same reason. A centroid
built under one provider is not comparable to vectors from another, and the
failure is silent: every similarity just drifts. On a provider change, topics
whose config no longer matches keep their members and their counters but take no
new ones, rather than quietly mixing two vector spaces.

### What it looks like working

Against the seeded demo workspace (31 conversations across five planted
subjects), a run produces 14 topics and flags three gaps:

```
OVERVIEW  analyzed=31  contained=68%  covered=52%  handedOff=4  escalated=4

KNOWLEDGE GAPS FLAGGED: 3
  n=5 cov= 0% | Any timeline on SAML support
  n=4 cov=50% | Why is there no VAT on my invoice
  n=3 cov=33% | How do I reset my password
```

Refunds and rate limits are not flagged, because the seed gives those replies
real citations. That is the whole feature in four lines: the subjects nobody has
documented rise to the top, and the documented ones stay quiet.

## The article draft refuses to write answers

The model is given the questions and **not** the answers, and the prompt
forbids it from supplying any. What comes back is a structure: the questions,
deduplicated and grouped, each marked `ANSWER NEEDED`.

An article invented here would go into the knowledge base, get retrieved, and be
cited to a customer as though somebody had written it. That is worse than the
gap it was meant to fill: an ungrounded answer in a transcript is at least
visible as ungrounded, while an invented knowledge source launders itself into a
citation.

Drafts are filed as **Unorganized** by default, which the knowledge feature
treats as unreachable by every agent — there is no "search everything" mode. An
unfinished draft therefore cannot be retrieved until a person files it.

## Boundaries

The intelligence feature writes no SQL over `conversations` or `messages`.
`src/features/conversations/server/analysis-source.ts` is the read model the
conversations feature exports, so what counts as a grounded answer or a human
reply stays owned there. Filing a draft goes through
`createKnowledgeSource` rather than an insert, so the draft is actually indexed
instead of existing as a row retrieval cannot see.

## Cost ceiling of a run

| Bound | Value |
| --- | --- |
| Conversations analyzed | `MAX_CONVERSATIONS_PER_RUN` = 2,000 |
| Topics labelled (model calls) | `MAX_TOPICS_LABELED_PER_RUN` = 25 |
| Label concurrency | 4 |
| Runs per workspace per hour | 6 (route rate limit) |
| Concurrent runs per workspace | 1 (partial unique index) |

The one-run lock is a partial unique index rather than a check-then-insert in
the service, which races with itself. A run abandoned by a dead process is
released after 30 minutes — without that, one crash would lock a workspace out
of the feature permanently, since nothing else would ever clear the row.

## Deliberately not in phase 1

- **No scheduled runs.** Introducing a job runner is its own decision.
- **No sentiment or intent classification.** Both are a model's opinion about a
  conversation; grounding and hand-off are facts about it. Facts first.
- **No cross-workspace benchmarks.** Tenant data does not leave its tenant.
- **No topic merge or split.** Renaming is supported; restructuring clusters by
  hand needs a rebuild path that does not exist yet.
- **No per-chatbot or per-agent breakdown of topics.** The data supports it
  (`conversations.chatbot_id`); the screen does not yet.

## Tests

| File | Covers |
| --- | --- |
| `tests/unit/intelligence-metrics.test.ts` | Outcome derivation, rates, gap scoring, the SQL/TS identity |
| `tests/unit/intelligence-clustering.test.ts` | Vector maths, assignment, the forced and skipped cases |
| `tests/unit/intelligence-prompts.test.ts` | Label parsing and fallback naming, article title derivation |
| `tests/unit/intelligence-filters.test.ts` | URL parsing, and that the server schema agrees with it |
| `tests/unit/intelligence-persistence.integration.test.ts` | A full run against PostgreSQL, idempotence, counters, isolation, the run lock |

## Seeing it locally

`pnpm db:seed` plants 31 conversations across five recurring subjects with a
deliberate mix of grounding and hand-offs. It does **not** seed topics or
insights: those are derived, and seeding them would fake the one thing worth
watching work. Open `/w/demo/intelligence` and run an analysis.
