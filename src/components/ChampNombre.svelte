<script lang="ts">
  // Saisie numérique facultative : accepte la virgule décimale, vide = « non renseigné ».
  let {
    valeur = $bindable(),
    min = -Infinity,
    max = Infinity,
    pas = 'any',
    entier = false,
    placeholder = '—',
    id,
    etiquette,
    largeur,
    onchange,
  }: {
    valeur: number | null;
    min?: number;
    max?: number;
    pas?: string;
    entier?: boolean;
    placeholder?: string;
    id?: string;
    etiquette?: string;
    largeur?: string;
    onchange?: (v: number | null) => void;
  } = $props();

  let texte = $state(valeur == null ? '' : String(valeur).replace('.', ','));
  let invalide = $state(false);
  let enEdition = false;

  $effect(() => {
    const v = valeur;
    if (!enEdition) texte = v == null ? '' : String(v).replace('.', ',');
  });

  function saisir(e: Event) {
    enEdition = true;
    texte = (e.target as HTMLInputElement).value;
    const s = texte.trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') { invalide = false; valeur = null; onchange?.(null); return; }
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max || (entier && !Number.isInteger(n))) { invalide = true; return; }
    invalide = false;
    valeur = n;
    onchange?.(n);
  }
</script>

<input
  {id}
  type="text"
  inputmode="decimal"
  class:invalide
  style:width={largeur}
  value={texte}
  {placeholder}
  aria-label={etiquette}
  aria-invalid={invalide}
  title={invalide ? `Valeur attendue${entier ? ' entière' : ''} entre ${min} et ${max}` : undefined}
  data-pas={pas}
  oninput={saisir}
  onblur={() => { enEdition = false; if (!invalide) texte = valeur == null ? '' : String(valeur).replace('.', ','); }}
/>
