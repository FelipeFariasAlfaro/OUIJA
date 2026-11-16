/** Créditos de OUIJA. Son los únicos enlaces externos que la interfaz puede abrir. */
export const ABOUT = {
  author: 'Felipe Farías',
  email: 'farias3felipe@gmail.com',
  repo: 'https://github.com/FelipeFariasAlfaro/OUIJA',
  linkedin: 'https://www.linkedin.com/in/felipefariasalfaro/'
} as const

export const ABOUT_LINKS: readonly string[] = [`mailto:${ABOUT.email}`, ABOUT.repo, ABOUT.linkedin]
