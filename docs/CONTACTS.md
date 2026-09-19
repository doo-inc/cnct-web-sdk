# Contacts

The account's contact directory, on an operator's console session — a person's login, eight hours long,
carrying whatever that person's role allows. It is the right credential for a back-office app run by
staff, and the wrong one for anything a customer holds.

There is no contacts surface on the API-key credential today, so an unattended integration cannot reach
this. That is the platform's boundary rather than this SDK's, and it is worth knowing before you design
around it.

## Signing in

```js
const { session, challenge } = await cnct.auth.login({ email, password });
```

Three things can come back, and only one of them is an error:

- **A session.** `session.credentials` is what the directory needs. `session.mustChangePassword` is
  worth honouring — the console does.
- **A challenge.** MFA is the ordinary path for an account that has it on, not an error to catch. Hold
  `challenge.mfaToken` — five minutes, scoped to this attempt — and call
  `auth.verifyMfa({ mfaToken, code })`. Where `challenge.method` is `EMAIL`, `auth.resendEmailCode()`
  asks for another.
- **`CnctChooseOrganization`,** thrown, when the person has seats in more than one account. Put
  `error.organizations` in front of them and call `login` again with the slug they chose.

A wrong password is `unauthenticated`. The server does not say which half was wrong and neither does
this.

`auth.whoAmI(token)` is the cheapest way to check a token you already hold is still good.

## Reading the directory

```js
let page = await contacts.list({ query: 'layla', limit: 100 });
while (page.nextCursor) {
  page = await contacts.list({ query: 'layla', cursor: page.nextCursor });
}
```

or, for everything:

```js
for await (const contact of contacts.listAll({ query: 'layla' })) { … }
```

**Cursor, not offset**, and that is not a style choice: every inbound message touches the contact it
belongs to, so the order is being rewritten while somebody scrolls it. Under an offset that is page two
silently re-showing half of page one. `nextCursor` of `null` is the end, and it is the only reliable one
— a short page never issues a cursor, so a list cannot spin on a final request that returns nothing.

`page.total` is everything the filters match, not just this page, so a pager can say where in it you are.

`attributes` narrows by the account's own fields as `key:value` pairs, repeated rather than joined:
`{ attributes: ['plan:gold', 'tier:2'] }`.

## Three identities, and why a name is not one

A contact is found by a **phone number**, an **email address**, or `identifier` — the client's own id for
somebody, and the one identity a business controls, therefore the only one that cannot be a coincidence.
Each is unique per account and each is optional.

At least one is required to create a contact, and the name is not one of them. Two people called Ahmed
are two people; a directory keyed on what somebody is called is a directory that merges strangers. The
SDK refuses that call before it reaches the wire.

A collision throws `CnctContactConflict`, which names who it collided with:

```js
try {
  await contacts.create({ name: 'Layla', phoneNumber: '+97312345678' });
} catch (error) {
  if (error instanceof CnctContactConflict) open(error.existingId); // not "go and search for them"
}
```

## Changing a record

`update` is a partial: omitted fields are left alone, and an empty string clears a field rather than
storing `""`. `customAttributes` is itself a patch — send only the keys that changed, and `null` to
clear one.

The three identities are deliberately not editable here. Correcting somebody's number is a **merge**, not
an edit:

```js
await contacts.merge({ contactId: duplicate.id, into: keep.id });
```

Never do this speculatively. Identity resolution refuses to merge on its own for a reason: a shared
household number is not proof that two histories belong to one person. This is the explicit decision,
made while looking at both records — and the duplicate is deleted.

## Tags

Tags describe a person; labels describe a conversation. The two pools were split deliberately, so a tag
id is never a label id. `contacts.tags()` is where a tag id comes from — `addTag` and `create` both take
ids, never names.
