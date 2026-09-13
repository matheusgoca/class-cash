import { supabase } from '@/integrations/supabase/client';
import { getConsoleBuffer } from '@/lib/consoleCapture';

export interface SubmitDebugReportParams {
  schoolId: string;
  userId: string;
  comment: string;
  screenshotBlob: Blob | null;
  videoBlob: Blob | null;
}

const BUCKET = 'debug-reports';

export async function submitDebugReport(params: SubmitDebugReportParams): Promise<void> {
  const { schoolId, userId, comment, screenshotBlob, videoBlob } = params;
  const reportId = crypto.randomUUID();

  let screenshotPath: string | null = null;
  if (screenshotBlob) {
    screenshotPath = `${schoolId}/${reportId}/screenshot.png`;
    const { error } = await (supabase as any).storage
      .from(BUCKET)
      .upload(screenshotPath, screenshotBlob, { contentType: 'image/png' });
    if (error) throw error;
  }

  let videoPath: string | null = null;
  if (videoBlob) {
    videoPath = `${schoolId}/${reportId}/video.webm`;
    const { error } = await (supabase as any).storage
      .from(BUCKET)
      .upload(videoPath, videoBlob, { contentType: 'video/webm' });
    if (error) throw error;
  }

  const { error } = await (supabase as any).from('debug_reports').insert({
    id: reportId,
    school_id: schoolId,
    user_id: userId,
    comment,
    page_url: window.location.pathname,
    user_agent: navigator.userAgent,
    screenshot_path: screenshotPath,
    video_path: videoPath,
    console_logs: getConsoleBuffer(),
  });
  if (error) throw error;
}
