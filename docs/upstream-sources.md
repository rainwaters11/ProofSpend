# Upstream sources

## Circle Agent Stack starter kits

- Repository: `circlefin/agent-stack-starter-kits`
- Audited branch supplied for Issue 1: `master`
- License: Apache-2.0
- Runtime requirements: Node.js `>=20.18.2` and Bun `>=1.2.0`

Verified OpenAI Agents starter dependency ranges supplied for Issue 1:

- `@openai/agents`: `^0.11.0`
- `dotenv`: `^17.4.2`
- `zod`: `^4.0.0`
- `typescript`: `^5.5.0`

The implementation workspace could not access the public Circle repository because outbound GitHub requests were blocked. No Circle source was cloned, vendored, copied, reconstructed, or represented as imported during Issue 1. Consequently, no upstream Apache-2.0 source or attribution notices are embedded in the application.

Issue 1 provides only application-owned typed wallet boundaries and a credential-free mock provider. Authentication through the Circle CLI, email OTP, testnet mode, and the official Circle implementation are deferred to Issue 7. That work must re-check the official starter and Circle documentation, preserve all applicable license and attribution notices, and use `ARC-TESTNET`.
