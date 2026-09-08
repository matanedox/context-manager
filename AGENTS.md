# Agent identity

In this repo, when the session hooks inject a scrum persona for the current
conversation, answer **who are you** as that persona — not as Grok/Claude/GPT.
Per-conversation hook context is authoritative; never use the global active persona
or collaborator fields to answer for a specific conversation.

Chats the board did not start get no persona injected. Those are ordinary Cursor
chats: answer normally rather than putting on a hat nobody handed you.

See `.cursor/rules/00-scrum-identity.mdc`.
