import {ENGINE_LABELS, knowledgeScore, summarizeRecommendations} from './recommendation-analysis.js';

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const keys = Object.keys(ENGINE_LABELS);
export const evidenceId = (queryIndex, engine) => `query-${queryIndex + 1}-${engine}`;

// Only observations already validated by recommendation-analysis may support a
// finding. No second market search, invented site defects or revenue estimates.
export function buildReportInsights(data) {
  const zones = Array.isArray(data.zoneOfInvisibility) ? data.zoneOfInvisibility : [];
  const summary = summarizeRecommendations(zones, data.brand, data.website);
  const knowledge = keys.map(key => {
    const value = (data.engines || []).find(item => item.key === key || item.label === ENGINE_LABELS[key]);
    return {key, label: ENGINE_LABELS[key], value, score: value ? knowledgeScore(value) : null};
  });
  const known = knowledge.filter(item => item.score !== null);
  const recognitionScore = known.length ? Math.round(known.reduce((n, item) => n + item.score, 0) / known.length) : null;
  const expectedQueries = Math.max(zones.length, Number.isInteger(data.queryPlan?.expectedCount) ? data.queryPlan.expectedCount : zones.length || 5);
  const queries = zones.map((zone, index) => {
    const checked = keys.filter(key => zone.analysisVersion === 2 && zone.engines?.[key]?.analysisStatus === 'ok');
    const recommended = checked.filter(key => zone.engines[key].brandRecommended === true || zone.engines[key].websiteRecommended === true);
    return {index, query:clean(zone.query), checked:checked.length, recommended:recommended.length,
      evidence:checked.map(key => evidenceId(index, key)), rate:checked.length ? recommended.length / checked.length : null};
  });
  const ranked = queries.filter(item => item.checked).sort((a,b) => a.rate - b.rate || b.checked - a.checked || a.index - b.index);
  const weakest = ranked[0], strongest = [...ranked].sort((a,b) => b.rate - a.rate || b.checked - a.checked)[0];
  const competitors = summary.competitors.map(company => ({...company,
    insteadCount:company.occurrences.filter(item => item.insteadOf).length,
    evidence:company.occurrences.map(item => evidenceId(item.queryNumber - 1, item.engine))}));
  const missing = expectedQueries * keys.length - summary.totalSuccessful;
  const findings = [], actions = [];
  if (summary.totalSuccessful) {
    findings.push({kind:'coverage', text:`Бренд рекомендовано у ${summary.totalRecommended} із ${summary.totalSuccessful} оцінених відповідей. Перевірка охопила ${zones.length} із ${expectedQueries} запланованих сценаріїв.`, evidence:queries.flatMap(item => item.evidence)});
    if (weakest) {
      findings.push({kind:'query', text:`Найменша частка рекомендацій у перевірці: «${weakest.query}» - ${weakest.recommended}/${weakest.checked} відповідей.`, evidence:weakest.evidence});
      actions.push({priority:'Високий', title:weakest.recommended < weakest.checked ? 'Перевірити представлення пріоритетної послуги' : 'Зберегти й перевірити сильний сценарій',
        observation:`«${weakest.query}»: ${weakest.recommended}/${weakest.checked} рекомендацій.`,
        action:weakest.recommended < weakest.checked
          ? `Для запиту «${weakest.query}» визначте відповідну сторінку послуги або категорії. Перевірте, чи вона прямо пояснює рішення, умови вибору й підтверджений досвід. Конкретні недоліки сторінки потребують окремого аудиту.`
          : `Перевірте точність опису й посилань у відповідях за запитом «${weakest.query}». Збережіть формулювання, дату й моделі для повторного вимірювання.`,
        impact:'Допоможе визначити, яку потребу покупця варто опрацювати першою; причина поточного результату ще не встановлена.', evidence:weakest.evidence});
    }
    const competitor = competitors[0];
    if (competitor) {
      findings.push({kind:'competitor', text:`${clean(competitor.name)} рекомендовано у ${competitor.occurrences.length} відповідях; у ${competitor.insteadCount} із них ваш бренд не рекомендований.`, evidence:competitor.evidence});
      actions.push({priority:'Середній', title:`Порівняти докази вибору: ${clean(competitor.name)}`,
        observation:`${clean(competitor.name)}: ${competitor.occurrences.length} рекомендацій у цій вибірці.`,
        action:`Перегляньте наведені AI аргументи на користь ${clean(competitor.name)} за конкретними запитами. Порівняйте зі своїми матеріалами: спеціалізація, умови, кейси, відгуки. Визначте, які правдиві докази вибору потрібно пояснити краще.`,
        impact:'Сформує предметний список для конкурентного розбору; частота згадок у скані не є часткою ринку.', evidence:competitor.evidence});
    }
    const confused = knowledge.filter(item => item.score === 50 || item.score === 0);
    if (confused.length) {
      actions.push({priority:'Високий', title:'Перевірити опис та ідентичність бренду',
        observation:`${confused.map(item => item.label).join(', ')}: ${confused.map(item => `${item.score}/100`).join(', ')} у блоці знання.`,
        action:`Порівняйте цитати ${confused.map(item => item.label).join(', ')} з офіційною назвою, діяльністю та географією компанії. Перевірте узгодженість цих даних на сайті й публічних профілях; виправляйте лише підтверджені розбіжності.`,
        impact:'Допоможе виявити плутанину з іншою компанією або неповний опис.', evidence:confused.map(item => `knowledge-${item.key}`)});
    } else if (strongest) {
      actions.push({priority:'Середній', title:'Відокремити знання бренду від вибору постачальника',
        observation:`Знання бренду: ${recognitionScore ?? 'немає даних'}${recognitionScore === null ? '' : '/100'}; рекомендації: ${summary.totalRecommended}/${summary.totalSuccessful}.`,
        action:`Збережіть усі 5 формулювань і конфігурацію моделей. Повторіть ту саму перевірку після конкретних змін, порівнюючи кожну пару AI та запиту. Для бізнес-ефекту окремо перевіряйте переходи й якісні звернення в аналітиці.`,
        impact:'Дасть порівнюване вимірювання; різний набір запитів не покаже надійної динаміки.', evidence:queries.flatMap(item => item.evidence)});
    }
  }
  if (!summary.totalSuccessful || missing) {
    const note = `Надійно оцінено ${summary.totalSuccessful} із ${expectedQueries * keys.length} очікуваних відповідей. Відсутні дані не означають, що AI не рекомендує бренд.`;
    if (!summary.totalSuccessful) findings.push({kind:'unavailable', text:note, evidence:[]});
    actions.unshift({priority:'Спочатку перевірка', title:'Доповнити відсутні відповіді', observation:note,
      action:'Повторіть невдалі кроки з тими самими запитами та моделями. До отримання даних не робіть висновок про відсутність рекомендацій або причини результату.',
      impact:'Зменшить невизначеність перед рішенням про роботи чи бюджет.', evidence:[]});
  }
  const priorityRank={'Спочатку перевірка':0,'Високий':1,'Середній':2};
  actions.sort((a,b)=>priorityRank[a.priority]-priorityRank[b.priority]);
  const topFinding = !summary.totalSuccessful ? findings[0].text : (findings.find(item => item.kind === 'query') || findings[0]).text;
  return {version:1, recognitionScore, knowledge, summary, queries, competitors, findings:findings.slice(0,3), actions:actions.slice(0,3),
    expectedQueries, checkedQueries:zones.length, expectedAnswers:expectedQueries * keys.length, checkedAnswers:summary.totalSuccessful, missingAnswers:missing,
    topFinding, priorityAction:actions[0]?.action || '', topCompetitor:competitors[0]?.name || '',
    confidence:summary.totalSuccessful === 0 ? 'unavailable' : missing > 0 ? 'partial' : 'complete'};
}
