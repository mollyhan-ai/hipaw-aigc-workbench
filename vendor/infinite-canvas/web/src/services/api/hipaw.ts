import type { AiConfig } from '@/stores/use-config-store';
import { imageToDataUrl } from '@/services/image-storage';
import type { ReferenceImage } from '@/types/image';

let options = { useBrand:true, useMascot:false, taskId:'' };
export const setHiPawOptions = (next: typeof options) => { options=next; };
export const isHiPaw = () => window.location.pathname.includes('/embed/');

export async function requestHiPaw(config: AiConfig, prompt: string, references: ReferenceImage[] = [], signal?: AbortSignal): Promise<Array<{id:string;dataUrl:string}>> {
    if (import.meta.env.VITE_HIPAW_STATIC === 'true') throw new Error('在线页面尚未连接生图服务，请使用本机 HiPaw 工作台。');
    const request = async (path: string, init: RequestInit = {}) => {
        const response = await fetch('/api'+path, {...init,signal});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '生图请求未完成');
        return result;
    };
    const refs = await Promise.all(references.map(image=>imageToDataUrl(image)));
    const job = await request('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,prompt,ratio:config.size==='auto'?'3:4':config.size,count:Number(config.count)||1,references:refs})});
    const cancel = () => { void fetch('/api/jobs/'+job.id,{method:'DELETE'}).catch(()=>undefined); };
    signal?.addEventListener('abort',cancel,{once:true});
    try {
        while (true) {
            signal?.throwIfAborted();
            const result = await request('/jobs/'+job.id);
            if (result.status==='success') return result.images.map((image:{id:string;url:string})=>({id:image.id,dataUrl:new URL(image.url,location.origin).href}));
            if (result.status==='failed'||result.status==='cancelled') throw new Error(result.error||'生成已取消');
            await new Promise(resolve=>setTimeout(resolve,2000));
        }
    } finally { signal?.removeEventListener('abort',cancel); }
}
