# Explicit headless reconciliation scope

New verification intents and final-send claims retain their declared operation
scope and data mode. Dispatch reconciliation validates the original definition
under that exact scope, rather than the legacy default. Standard-mail claims
cannot admit AI actions, attachment downloads or synthetic dispatch, and their
original native context must match mailbox mode.

Historical intents or claims without an explicit scope remain unresolved. They
are not rewritten, reset or replayed. Original verification reconciliation still
establishes only correlated terminal metadata and releases uncertainty; it grants
no success, task acceptance, new operation or send authority.

The base definition validator recognizes the exact stronger mailbox guard that
also requires dispatch=false. It grants no read authority to the else branch and
does not change the existing connector, recipient or send-retry restrictions.

Lifecycle rehearsal requests at most 100 recent history rows and refuses a
saturated response before a state change. Its receipt explicitly labels comparison
of the bounded recent snapshot. It does not certify exhaustive history or absence
of older runs. Active/unknown rows, changed snapshots or uncertain transitions
still fail, and the existing operation journals and deadlines remain in force.

Tests use synthetic provider responses. These corrections do not establish native
service compatibility, complete provider pagination, a deployed workflow, real
mail analysis, an accepted report, an email send or an Inbox delivery receipt.
