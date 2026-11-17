/** Créditos de OUIJA. Son los únicos enlaces externos que la interfaz puede abrir. */
export const ABOUT = {
  author: 'Felipe Farías',
  repo: 'https://github.com/FelipeFariasAlfaro/OUIJA',
  linkedin: 'https://www.linkedin.com/in/felipefariasalfaro/'
} as const

export const ABOUT_LINKS: readonly string[] = [ABOUT.repo, ABOUT.linkedin]
