<script lang="ts">
  import { etat } from '../lib/etat.svelte';
</script>

<div class="toasts pas-imprimer" role="status" aria-live="polite">
  {#each etat.toasts as t (t.id)}
    <div class="toast {t.type}">{t.texte}</div>
  {/each}
</div>

<style>
  .toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; z-index: 5000; max-width: min(440px, calc(100vw - 36px)); }
  .toast { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--lien); border-radius: 6px; padding: 10px 14px; box-shadow: var(--ombre-haute); font-size: 13.5px; }
  .toast.ok { border-left-color: var(--m-normal); }
  .toast.err { border-left-color: var(--m-interdit); }
</style>
