# LaunchVault dependency map

Live issue dependencies override this synchronized map if they change.

```text
#16 -> #2 -> #14A -> #3 -> #4 -> #14B/eligible #14C -> #5 -> #6
                                                        |
                         #2 + #3 + #4 ----------------> #7
                         #2 + #7 ---------------------> #13 (ERC-8004)
              #4 + #5 + #6 + #7 + #13 -------------> #8  (ERC-8183)
                                                        |
                                                        v
                         #14D -> #9 -> #10
```

## Required edges

| Issue | Depends on | Boundary |
| --- | --- | --- |
| #7 | #2, #3, #4 | Circle execution ADR precedes implementation. |
| #13 | #2, #7 | ERC-8004 identity and reputation governance only. |
| #8 | #4, #5, #6, #7, #13 | ERC-8183 job lifecycle and settlement only. |

Issue #13 produces the registered identity that Issue #8 may consume. Issue #8 does not own registration or reputation governance.

## Frontend availability

- Phase A can follow the domain foundation without claiming product behavior.
- Phase B can establish truthful positioning and governance.
- Phase C compositions become eligible individually only when their corresponding domain contracts exist: founder/treasury after #2/#3; milestone after #4; evidence after #5; Backer View after #6; evaluator/activity protocol states after #7/#13/#8 as applicable.
- Phase D follows the protocol path in the default order and hardens the available experience.

## Research versus implementation

Circle research before Issue #7 may document official capabilities and risks. It may not select the execution architecture, add dependencies, modify adapters/configuration, create wallets, or transact. Issue #7 implementation waits for #2/#3/#4 and an approved ADR.

## Unassigned runtime

Complete Verification Agent orchestration has no current implementation issue. A dedicated future issue is required unless the live backlog explicitly assigns it elsewhere; it is not an implicit dependency hidden inside #13 or #8.
