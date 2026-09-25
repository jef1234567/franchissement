<script lang="ts">
  import { LIBELLE_MODE, type ModeRequis } from '../core/verification';
  let { mode, libelle }: { mode: ModeRequis; libelle?: string } = $props();
</script>

<span class="pastille {mode}">{libelle ?? LIBELLE_MODE[mode]}</span>
