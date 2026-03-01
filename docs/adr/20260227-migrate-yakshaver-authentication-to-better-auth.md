- Status: accepted <!-- optional: draft | proposed | rejected | accepted | deprecated | … | superseded by [xxx](yyyymmdd-xxx.md) -->
- Deciders: @ricksu978 @tomek-i @steven0x51 @yaqi-lyu @calumjs @Hajir2005 @jeoffreyfischer <!-- optional: list everyone involved in the decision -->
- Date: 2026-02-27 <!-- optional. YYYY-MM-DD when the decision was last updated. To customize the ordering without relying on Git creation dates and filenames -->

Technical Story: [Enable social sign-in (GitHub, Google) and reduce sign-up friction for YakShaver](https://github.com/SSWConsulting/SSW.YakShaver/issues/1798) <!-- optional: description | ticket/issue URL -->

## Context and Problem Statement

YakShaver Portal and Desktop app currently only support enterprise authentication via Microsoft Entra ID, which blocks non-enterprise users from signing up. As a customer-facing product, YakShaver should provide modern social sign-in options (e.g. GitHub and Google) and align with the authentication experience of other SSW products such as SugarLearning, TimePro, and SSW Rewards. 
How can we expand authentication options quickly while balancing long-term architectural alignment with the broader SSW ecosystem? 
<!-- required: Describe the context and problem statement, e.g., in free form using two to three sentences. You may want to articulate the problem in the form of a question. -->

## Decision Drivers <!-- optional -->

- Reduce sign-up friction and increase adoption
- Support social providers (GitHub, Google)
- Deliver YakShaver to market as soon as possible
- Maintain reasonable security and token handling practices
- Align with SSW’s long-term authentication strategy

## Considered Options

- Migrate from Next-Auth to Better-Auth (successor to Next-Auth)
- Migrate to SSW.IdentityServer

## Decision Outcome

Chosen option: "**Option 1: Migrate from Next-Auth to Better-Auth (successor to Next-Auth)**", because it enables faster delivery under current time constraints while supporting required social sign-in features. Although migrating to SSW.IdentityServer would better align with long-term SSW strategy, the additional effort (4–5 sprints) conflicts with the immediate release goals for YakShaver.
The team has voted to proceed with Better-Auth and revisit IdentityServer alignment in the future if required.


### Consequences <!-- optional -->

- ✅ Faster time to market (approximately 1 sprint effort)
- ✅ Supports GitHub, Google, email/password, and magic link authentication out-of-the-box
- ✅ Lower immediate engineering effort
- ❌ Authentication logic remains in the frontend tier rather than a dedicated identity service (less separation of concerns)
- ❌ Not fully aligned with the authentication model used by other SSW products
- ❌ Future migration to IdentityServer may still be required

## Pros and Cons of the Options <!-- optional -->

### Migrate from Next-Auth to Better-Auth (successor to Next-Auth)

Better-Auth (the successor to Next-Auth) integrates directly with Next.js and provides built-in support for social providers and passwordless authentication. <!-- optional: example | description | pointer to more information | … -->

- ✅ Integrates with social sign-in and email/password out-of-the-box
- ✅ Supports magic link (passwordless authentication)
- ✅ Low implementation effort (~1 sprint)
- ❌ Requires migration effort from current Entra ID setup
- ❌ Auth logic lives in the frontend tier rather than a dedicated identity service
- ❌ No unified SSW account across products

### Migrate to SSW.IdentityServer

Adopt the central SSW identity platform (based on IdentityServer) to unify authentication across all SSW products. <!-- optional: example | description | pointer to more information | … -->

- ✅ Centralised identity management (one SSW account across products)
- ✅ Strong alignment with other SSW products and branding
- ✅ Long-term strategic standard for SSW applications
- ✅ Enterprise-grade security model
- ❌ Higher implementation effort (4–5 sprints across Next.js and .NET Core)
- ❌ Additional load and scaling considerations on IdentityServer
- ❌ Potential single point of failure if misconfigured (e.g., expired certificates, lack of load balancing)


## Links <!-- optional -->

- [Better-Auth](https://better-auth.com) <!-- example: Refined by [xxx](yyyymmdd-xxx.md) -->