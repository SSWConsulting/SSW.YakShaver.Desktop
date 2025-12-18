# Use Drizzle ORM and SQLite for Electron Data Storage

- Status: proposed <!-- optional: draft | proposed | rejected | accepted | deprecated | … | superseded by [xxx](yyyymmdd-xxx.md) -->
- Deciders: @tomek-i @yaqi-lyu 
- Date: {{ LAST MODIFIED 2025-12-18 }} 
- Tags:  ORM, SQLITE, database 

Technical Story:   
🧠 Spike: Storing Desktop Shave Metadata  
PBI: https://github.com/SSWConsulting/SSW.YakShaver.Desktop/issues/312

## Context and Problem Statement

Our Electron application requires reliable local data storage via SQLite. To ensure maintainability and type safety, we need to evaluate and select an ORM compatible with the Electron environment.  <!-- required: Describe the context and problem statement, e.g., in free form using two to three sentences. You may want to articulate the problem in the form of a question. -->

## Decision Drivers <!-- optional -->

- Migration Management<!-- e.g., a force, facing concern, … -->
- Ease of Distribution <!-- e.g., a force, facing concern, … -->
- Developer Experience <!-- numbers of drivers can vary -->
- Maintainability

## Considered Options

1. Prisma
2. Drizzle

## Decision Outcome

Chosen option: "**Drizzle**", because it offers significantly smaller bundle size and a simplified migration flow that runs directly within the Electron process. <!-- e.g., only option, which meets k.o. criterion decision driver | which resolves force force | … | comes out best (see below) -->.

### Consequences <!-- optional -->

- ✅ Reduces app size by ~15–50MB compared to Prisma.
- ✅ Native migrate() function allows for a simple Promise-based startup sequence.
- ✅ No need to manage platform-specific engine binaries for cross-compilation..
- ❌ Less familiar for most developers. Smaller community and fewer third-party GUI tools compared to Prisma.

## Pros and Cons of the Options <!-- optional -->

### Prisma

A mature, feature-rich ORM with its own schema definition language (DSL). <!-- optional: example | description | pointer to more information | … -->

- ✅ Very mature ecosystem and excellent GUI tools
- ❌ Requires forking a child process to run migrations in production.
- ❌ Adds 15–50MB to the bundle due to the required Query Engine and Migration Engine binaries.
- ❌ The engine binaries are platform specific, need matching them to OS.

### Drizzle

The lightweight TypeScript ORM that maps closely to standard SQL syntax. <!-- optional: example | description | pointer to more information | … -->

- ✅ Minimal footprint (~30kb).
- ✅ Supports in-process programmatic migrations via migrate() function.
- ✅ No native binaries required except the SQLite driver itself.
- ❌ Less familiar to developers. Smaller community.

## Links <!-- optional -->

- [Drizzle](https://orm.drizzle.team/) <!-- example: Refined by [xxx](yyyymmdd-xxx.md) -->
- [Prisma](https://www.prisma.io/)
- [Using Prisma with the Electron Framework](https://github.com/prisma/prisma/issues/9613)
- [Why shipping Prisma with our Electron app was a mistake](https://www.sabatino.dev/why-shipping-prisma-with-our-electron-app-was-a-mistake/)
- [Goodbye Prisma, Hello Drizzle](https://www.dbpro.app/blog/goodbye-prisma-hello-drizzle)