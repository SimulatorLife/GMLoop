# Codex agent surfaces

The roles registered in this workspace are OpenAI-backed roles for the
ChatGPT desktop dispatcher. A ChatGPT sign-in cannot send local Claude,
MiniMax, or Antigravity model IDs through that dispatcher; those IDs are
rejected before local hooks run.

External provider turns remain available through the shared versioned
integration in RacingGame. From an OpenAI parent, invoke a bounded turn with:

```sh
/Users/henrykirk/Desktop/RacingGame/scripts/codex/run-provider-agent.sh \
  --provider claude --role worker --prompt 'Bounded GMLoop task.'
```

Use `--provider minimax` or `--provider antigravity` for those providers. The
launcher starts the matching local bridge and selects the provider profile.
