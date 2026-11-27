// Presentation rules for the compact PDF. These bands are internal reading
// guides, not market benchmarks or guarantees of commercial performance.
export const REPORT_SIGNALS = Object.freeze({
 good: {tone:'good', color:'#16734A', light:'#65E2AA', fill:'#E7F3EC', icon:'good', label:'Сильний результат'},
 attention: {tone:'attention', color:'#A4560B', light:'#FFBD78', fill:'#FFF0DF', icon:'attention', label:'Потребує уваги'},
 critical: {tone:'critical', color:'#B63336', light:'#FF979B', fill:'#FBEAEB', icon:'critical', label:'Низький результат'},
 unavailable: {tone:'unavailable', color:'#656862', light:'#C8CDC5', fill:'#ECEEE9', icon:'unavailable', label:'Немає оцінки'},
});

export function scoreSignal(score, {checked=1, expected=1}={}) {
 if (!Number.isFinite(score) || score<0 || score>100 || checked<=0) return REPORT_SIGNALS.unavailable;
 if (checked<expected) return {...REPORT_SIGNALS.attention, label:'Неповні дані'};
 return score<40 ? REPORT_SIGNALS.critical : score<75 ? REPORT_SIGNALS.attention : REPORT_SIGNALS.good;
}

export function recommendationSignal(zone,key) {
 const answer=zone.engines?.[key];
 if (zone.analysisVersion!==2 || answer?.analysisStatus!=='ok') return REPORT_SIGNALS.unavailable;
 if (answer.brandRecommended===true || answer.websiteRecommended===true) return REPORT_SIGNALS.good;
 // A mention without a recommendation is a different state from absence or
 // an explicitly negative answer. Missing data is never painted as failure.
 return answer.targetStatus==='mentioned' ? REPORT_SIGNALS.attention : REPORT_SIGNALS.critical;
}

// Small original vector marks: crisp at any zoom, with the same line weight
// and cut-corner language. Shapes and text carry meaning alongside colour.
export function drawReportIcon(doc,kind,x,y,size,color) {
 doc.save().translate(x,y).scale(size/24).lineWidth(1.65).lineCap('round').lineJoin('round').strokeColor(color).fillColor(color);
 const line=(points)=>{doc.moveTo(...points[0]);for(const p of points.slice(1))doc.lineTo(...p);doc.stroke();};
 if(kind==='good') {
  doc.circle(12,12,9).stroke();line([[7.5,12],[10.5,15],[16.5,8.5]]);line([[18.5,3.5],[21,1]]);
 } else if(kind==='critical') {
  doc.polygon([7,2.5],[17,2.5],[22,7.5],[22,16.5],[17,21.5],[7,21.5],[2,16.5],[2,7.5]).stroke();
  line([[12,7],[12,12.5]]);doc.circle(12,17,1).fill();
 } else if(kind==='attention') {
  doc.path('M10 2.5 C4.5 3.5 1 8.5 2.5 14 C4 19.5 10 22.5 15 20.5').stroke();
  doc.path('M15 3 C20 4.5 22.5 10 20.5 15').stroke();line([[12,7.2],[12,12.8]]);doc.circle(12,17,1).fill();
 } else if(kind==='unavailable') {
  doc.circle(12,12,9).dash(2.2,{space:2}).stroke().undash();line([[8,12],[16,12]]);
 } else if(kind==='brand') {
  doc.path('M19 6 C15 1 6 2 3.5 8 C.5 15 6 22 13 21').stroke();
  doc.path('M16.5 8 C12 4.5 6 8 7 13 C7.8 17 11 18 14 17').stroke();
  doc.circle(12,12,1.8).fill();line([[16,16],[21,11]]);doc.circle(21,11,1.5).stroke();
 } else if(kind==='recommend') {
  doc.path('M4 3 H17 L21 7 V16 H12 L7 21 V16 H3 V7 Z').stroke();line([[7,9.5],[10,12.5],[16,6.5]]);
 } else if(kind==='compare') {
  line([[3,6],[9,6],[15,18],[21,18]]);line([[3,18],[9,18],[15,6],[21,6]]);
  doc.circle(3,6,1.5).fill();doc.circle(3,18,1.5).fill();line([[18,3],[21,6],[18,9]]);line([[18,15],[21,18],[18,21]]);
 } else if(kind==='target') {
  doc.circle(10,14,8).stroke();doc.circle(10,14,4).stroke();line([[10,14],[20,4]]);line([[16,3],[21,3],[21,8]]);
 } else {
  doc.path('M20 8 C17 1 7 1 3 8 C-1 16 7 24 14 21 C18 20 21 16 21 12').stroke();
  line([[15,8],[21,8],[21,2]]);
 }
 doc.restore();
}
