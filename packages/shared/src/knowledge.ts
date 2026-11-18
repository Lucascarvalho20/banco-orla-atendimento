/**
 * Tamanho do vetor do `nomic-embed-text`. O banco (coluna `vector(768)`) e a IA usam este valor:
 * trocar o modelo de embedding exige nova migration + reprocessar a base inteira.
 */
export const EMBEDDING_DIMENSIONS = 768;
