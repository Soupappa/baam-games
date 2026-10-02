# BAAM.GAMES

Portail territorial des jeux BAAM. L'interface est un plateau physique : les cartes
tombent, se heurtent, s'accrochent et recomposent le tas lorsqu'un jeu s'ouvre.

## Lancer

Double-cliquer sur `lancer-site.bat`, ou :

```bash
npm run build
npm run serve
```

Puis ouvrir `http://127.0.0.1:8090/`.

## Agrégation

`portal.config.json` déclare les quatre sources. Le compilateur essaie, dans l'ordre :

1. le `baam.json` du dépôt local ;
2. son URL publique `/.well-known/baam.json` ;
3. la dernière copie valide dans `data/manifests/`.

Une relation n'est déclarée que dans un sens. Le build valide le vocabulaire, calcule
les inverses et publie `public/data/registry.json`, `graph.json`, `graph.jsonld` et le
sitemap. Les manifestes et exports machine ne sont pas montrés dans l'interface.

