import api from './api.js';

export async function downloadScreeningReport(reportItem) {
  const response = await api.get(
    `/patients/me/screenings/${reportItem.screeningSessionId}/reports/${reportItem.id}.pdf`,
    { responseType: 'blob' },
  );
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `screening-report-${reportItem.id}.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
