export interface ImageAnalysis {
  summary: string;
  questions: { id: string; question: string; options: string[] }[];
}
export interface ImageAnswer { question: string; answer: string }
