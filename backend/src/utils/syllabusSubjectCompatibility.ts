type SubjectDomain = 'ARTIFICIAL_INTELLIGENCE' | 'DATABASE_SYSTEMS' | 'OPERATING_SYSTEMS' | 'CLOUD_MICROSERVICES';

export interface SyllabusSubjectCompatibility {
  compatible: boolean;
  selectedSubject: string;
  detectedTopic?: string;
}

const DOMAIN_SIGNALS: Record<SubjectDomain, { label: string; cues: Array<{ weight: number; pattern: RegExp }> }> = {
  ARTIFICIAL_INTELLIGENCE: {
    label: 'Artificial Intelligence',
    cues: [
      { weight: 5, pattern: /\bartificial intelligence\b/i },
      { weight: 4, pattern: /\bmachine learning\b/i },
      { weight: 4, pattern: /\bneural networks?\b/i },
      { weight: 4, pattern: /\bknowledge representation\b/i },
      { weight: 3, pattern: /\bnatural language processing\b|\bnlp\b/i },
      { weight: 3, pattern: /\bcomputer vision\b/i },
      { weight: 3, pattern: /\bintelligent agents?\b/i },
      { weight: 3, pattern: /\bexpert systems?\b/i },
      { weight: 1, pattern: /\bAI\b/i }
    ]
  },
  DATABASE_SYSTEMS: {
    label: 'Database Management Systems',
    cues: [
      { weight: 5, pattern: /\bdatabase management systems?\b|\bDBMS\b/i },
      { weight: 3, pattern: /\bSQL\b/i },
      { weight: 3, pattern: /\brelational databases?\b/i },
      { weight: 3, pattern: /\bnormalization\b/i },
      { weight: 2, pattern: /\bprimary keys?\b|\bforeign keys?\b/i },
      { weight: 2, pattern: /\btransactions?\b/i },
      { weight: 4, pattern: /\btransaction management\b/i },
      { weight: 4, pattern: /\bACID\b/i },
      { weight: 3, pattern: /\bconcurrency control\b/i },
      { weight: 3, pattern: /\bserializability\b|\bserializable\b/i },
      { weight: 2, pattern: /\blocking protocols?\b/i },
      { weight: 2, pattern: /\bER models?\b|\bentity.relationship models?\b/i },
      { weight: 2, pattern: /\bquery processing\b|\brelational algebra\b/i }
    ]
  },
  OPERATING_SYSTEMS: {
    label: 'Operating Systems',
    cues: [
      { weight: 5, pattern: /\boperating systems?\b/i },
      { weight: 3, pattern: /\bprocess scheduling\b/i },
      { weight: 2, pattern: /\bprocesses\b/i },
      { weight: 2, pattern: /\bthreads\b/i },
      { weight: 3, pattern: /\bmemory management\b/i },
      { weight: 3, pattern: /\bfile systems?\b/i },
      { weight: 2, pattern: /\bkernels?\b/i },
      { weight: 2, pattern: /\bdeadlocks?\b/i }
    ]
  },
  CLOUD_MICROSERVICES: {
    label: 'Cloud Microservices',
    cues: [
      { weight: 4, pattern: /\bcloud computing\b/i },
      { weight: 4, pattern: /\bcloud microservices?\b/i },
      { weight: 4, pattern: /\bmicroservices?\b/i },
      { weight: 3, pattern: /\bcloud.native\b/i },
      { weight: 3, pattern: /\bcontainerization\b|\bcontainers?\b/i },
      { weight: 3, pattern: /\bDocker\b/i },
      { weight: 3, pattern: /\bKubernetes\b/i },
      { weight: 2, pattern: /\bcloud service\b|\bcloud deployment models?\b/i },
      { weight: 2, pattern: /\bAWS\b|\bAzure\b|\bGoogle Cloud\b/i },
      { weight: 2, pattern: /\bservice discovery\b|\bload balancing\b/i }
    ]
  }
};

function resolveSubjectDomain(subject: string): SubjectDomain | undefined {
  const normalized = subject.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\b(artificial intelligence|ai)\b/.test(normalized)) return 'ARTIFICIAL_INTELLIGENCE';
  if (/\b(database management systems?|dbms|databases?)\b/.test(normalized)) return 'DATABASE_SYSTEMS';
  if (/\b(operating systems?|os)\b/.test(normalized)) return 'OPERATING_SYSTEMS';
  if (/\b(cloud|microservices?)\b/.test(normalized)) return 'CLOUD_MICROSERVICES';
  return undefined;
}

function scoreDomain(text: string, domain: SubjectDomain): number {
  return DOMAIN_SIGNALS[domain].cues.reduce(
    (score, cue) => score + (cue.pattern.test(text) ? cue.weight : 0),
    0
  );
}

function subjectTextMatchScore(subject: string, text: string): number {
  const ignored = new Set(['and', 'of', 'the', 'for', 'in', 'to', 'introduction', 'fundamentals', 'principles']);
  const subjectTerms = subject.toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2 && !ignored.has(term))
    .map((term) => term.endsWith('s') ? term.slice(0, -1) : term);
  if (!subjectTerms.length) return 0;

  const normalizedText = text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const matched = subjectTerms.filter((term) =>
    new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(normalizedText)
  );
  return matched.length / subjectTerms.length;
}

export function checkSyllabusSubjectCompatibility(
  selectedSubject: string,
  syllabusText: string
): SyllabusSubjectCompatibility {
  const selected = selectedSubject.trim();
  const selectedDomain = resolveSubjectDomain(selected);
  if (!syllabusText.trim()) return { compatible: false, selectedSubject: selected };

  const scores = (Object.keys(DOMAIN_SIGNALS) as SubjectDomain[])
    .map((domain) => ({ domain, score: scoreDomain(syllabusText, domain) }))
    .sort((left, right) => right.score - left.score);
  const strongest = scores[0];
  const selectedScore = selectedDomain ? scoreDomain(syllabusText, selectedDomain) : 0;
  const textMatch = subjectTextMatchScore(selected, syllabusText);

  if (
    selectedDomain &&
    strongest.domain !== selectedDomain &&
    strongest.score >= 10 &&
    selectedScore <= 4 &&
    strongest.score - selectedScore >= 8
  ) {
    return {
      compatible: false,
      selectedSubject: selected,
      detectedTopic: DOMAIN_SIGNALS[strongest.domain].label
    };
  }

  const compatible = textMatch >= 0.75 || (selectedDomain !== undefined && selectedScore >= 3);
  if (compatible) return { compatible: true, selectedSubject: selected };

  return {
    compatible: false,
    selectedSubject: selected,
    ...(strongest.score > 0 ? { detectedTopic: DOMAIN_SIGNALS[strongest.domain].label } : {})
  };
}

export function createSyllabusSubjectMismatchError(
  compatibility: SyllabusSubjectCompatibility
): Error & { statusCode: number; code: string } {
  const error = new Error(
    'You have uploaded/selected the wrong subject. Please upload the syllabus for the selected subject.'
  ) as Error & { statusCode: number; code: string };
  error.statusCode = 422;
  error.code = 'SYLLABUS_SUBJECT_MISMATCH';
  return error;
}
