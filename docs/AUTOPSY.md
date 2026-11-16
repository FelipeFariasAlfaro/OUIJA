# Autopsy report

Reproducible measurements of what OUIJA recovers and finds in `fixtures/chaos/` (13 files, including a 2008 ZIP backup with 3 entries). Run it yourself with `npm run autopsy`. Generated on 2026-11-16 on a machine with 16 CPU threads and 31 GB of RAM.

## Resurrection of dead formats

Each file holds a known phrase. "Opened as text" is what you see opening the bytes in a text editor today.

| File | Opened as text | OUIJA |
|---|---|---|
| WordPerfect (1990s) inside a 2008 ZIP | ✗ unreadable | ✦ resurrected |
| DOS text (CP437) inside a ZIP | ✗ unreadable | ✦ resurrected |
| Mojibake (UTF-8 read as Latin-1) | ✗ unreadable | ✦ resurrected |
| MSN Messenger history (2006) | ✗ unreadable | ✦ resurrected |
| Outlook Express folder (2004) | readable | ✦ resurrected |
| mbox mailbox (2009) | readable | ✦ resurrected |
| RTF | readable | ✦ resurrected |
| Photo copied in 2020, taken in 2011 (EXIF date) | 2020 | ✦ 2011 |

**7 of 7** dead or damaged files come back with their text (opening them as text: 3 of 7).

## Finding files by what you remember

12 questions in Spanish and English, without file names. Recall@k is the share of questions whose file appears in the first k results; MRR is the mean reciprocal rank.

| | Recall@1 | Recall@5 | MRR | Indexing time |
|---|---|---|---|---|
| Keywords only | 75% | 92% | 0.81 | 0.4 s |
| OUIJA (meaning + keywords, `bge-m3`) | 92% | 100% | 0.96 | 4.0 s |


<details><summary>Per-question results</summary>

| Question | Keywords only | OUIJA |
|---|---|---|
| ¿dónde está el poema para Rosa? | #1 borrador_final3.rtf | #1 rosa_v1.txt |
| agradecimientos de la tesis | #3 tesis_borrador_v2.wpd | #2 tesis_borrador_v2.wpd |
| lo que hablé con Rosa del disquete azul | #3 historial_rosa.xml | #1 historial_rosa.xml |
| la receta de la abuela que me mandó mi mamá | #1 familia.mbox | #1 familia.mbox |
| correo del profesor con correcciones | #1 Bandeja de entrada.dbx | #1 Bandeja de entrada.dbx |
| contrato del departamento | #1 contrato_arriendo_2015.txt | #1 contrato_arriendo_2015.txt |
| diario del viaje a Perú | #1 diario_viaje_peru.txt | #1 diario_viaje_peru.txt |
| logo de haka lens | #1 Logo Haka Lens blanco (1).png | #1 Logo Haka Lens blanco (1).png |
| audio de camila | #1 ElevenLabs_2026-11-13T22_56_23_Camila_pvc.mp3 | #1 ElevenLabs_2026-11-13T22_56_23_Camila_pvc.mp3 |
| chocolate cake recipe | #1 receta_torta.txt | #1 receta_torta.txt |
| the poem I wrote for Rosa | #1 borrador_final3.rtf | #1 borrador_final3.rtf |
| flat lease agreement | miss | #1 contrato_arriendo_2015.txt |

</details>
