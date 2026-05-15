# Clone a Private Repository

## Use an `onAuth` callback

To authenticate with a username and token, pass an `onAuth` callback to `clone()`:

```ts
import { sandbox } from "piebox";

const sb = sandbox();
await sb.clone({
  url: "https://github.com/your-org/private-repo",
  onAuth: () => ({
    username: "x-access-token",
    password: process.env.GITHUB_TOKEN!,
  }),
});
```

The callback is invoked by `isomorphic-git` whenever the remote requires credentials. Return an object with `username` and `password` fields.

## Use `headers` for Bearer token auth

To authenticate with a Bearer token instead of basic auth, pass an `Authorization` header:

```ts
import { sandbox } from "piebox";

const sb = sandbox();
await sb.clone({
  url: "https://github.com/your-org/private-repo",
  headers: {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  },
});
```

## Combine auth with a specific branch

To clone a specific branch from a private repo, add `ref`:

```ts
await sb.clone({
  url: "https://github.com/your-org/private-repo",
  ref: "feat/new-api",
  onAuth: () => ({
    username: "x-access-token",
    password: process.env.GITHUB_TOKEN!,
  }),
});
```

## Increase clone depth

By default, `clone()` performs a shallow clone with `depth: 1`. To fetch more history, set `depth`:

```ts
await sb.clone({
  url: "https://github.com/your-org/private-repo",
  depth: 50,
  onAuth: () => ({
    username: "x-access-token",
    password: process.env.GITHUB_TOKEN!,
  }),
});
```
