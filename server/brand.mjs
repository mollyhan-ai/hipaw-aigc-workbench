export const BASE_MODEL = 'FLUX.2 [dev]';
export const DEFAULT_BRAND = {
  id: 'hipaw', name: 'HiPaw', version: 1,
  colors: [],
  style: '清晰、温和、专业的宠物健康科普插画。构图简洁，留出标题与院区信息的排版空间。',
  avoid: '血腥画面、夸张的疗效暗示、拥挤背景。不要在生成图片里绘制 Logo 或长段文字。',
  font: '苹方 / 思源黑体', logoUrl: '', references: [],
  mascot: { name: 'HiPaw 吉祥物', referenceUrl: '', description: '', loraUrl: '', trigger: '', scale: 0.8, baseModel: BASE_MODEL }
};
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const text = (x, max = 5000) => String(x ?? '').trim().slice(0, max);
export function imagePath(value) {
  const path = text(value, 2000);
  if (path && !/^\/media\/[a-f0-9-]+\.(png|jpg|webp)$/.test(path)) throw new AppError('请从本机上传品牌图片');
  return path;
}
export function validateBrand(input, previous = DEFAULT_BRAND) {
  const mascot = input.mascot || {};
  if (input.colors != null && !Array.isArray(input.colors)) throw new AppError('配色需要为空或三个有效的颜色');
  const colors = (input.colors || []).map(x => text(x, 32));
  if (![0, 3].includes(colors.length) || colors.some(x => !/^#[a-f0-9]{6}$/i.test(x))) throw new AppError('配色需要为空或三个有效的颜色');
  const name = text(input.name, 80);
  if (!name) throw new AppError('请填写品牌名称');
  const loraUrl = text(mascot.loraUrl, 2000);
  if (loraUrl) {
    let url;
    try { url = new URL(loraUrl); } catch { throw new AppError('LoRA 地址需要是可访问的 HTTPS 下载链接'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new AppError('LoRA 地址需要是可访问的 HTTPS 下载链接');
    if (mascot.baseModel !== BASE_MODEL) throw new AppError('当前生图服务需要 FLUX.2 [dev] 版本的 LoRA');
  }
  const scale = Number(mascot.scale);
  if (!Number.isFinite(scale) || scale < 0 || scale > 2) throw new AppError('吉祥物影响强度需要在 0 到 2 之间');
  return {
    id: 'hipaw', version: previous.version + 1, updatedAt: new Date().toISOString(),
    name, colors, style: text(input.style), avoid: text(input.avoid), font: text(input.font, 100),
    logoUrl: imagePath(input.logoUrl), references: (input.references || []).slice(0, 12).map(imagePath),
    mascot: { name: text(mascot.name, 80), description: text(mascot.description), referenceUrl: imagePath(mascot.referenceUrl), loraUrl, trigger: text(mascot.trigger, 200), scale, baseModel: BASE_MODEL }
  };
}
export function buildGeneration(input, brand) {
  const prompt = text(input.prompt, 10000);
  if (!prompt) throw new AppError('先描述你想生成的画面');
  const useMascot = input.useMascot === true;
  if (useMascot && !brand.mascot.loraUrl) throw new AppError('吉祥物还没有配置训练好的 LoRA，请先到品牌中心设置');
  if (useMascot && brand.mascot.baseModel !== BASE_MODEL) throw new AppError('吉祥物 LoRA 的基础模型与生图服务不匹配');
  const sizes = { '1:1': { width: 1024, height: 1024 }, '3:4': { width: 960, height: 1280 }, '4:3': { width: 1280, height: 960 }, '16:9': { width: 1536, height: 864 }, '9:16': { width: 864, height: 1536 } };
  const ratio = input.ratio || '3:4';
  if (!sizes[ratio]) throw new AppError('请选择支持的画面比例');
  const count = Number(input.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new AppError('一次可以生成 1 到 4 张图片');
  const parts = [prompt];
  if (input.useBrand !== false) parts.push(`品牌：${brand.name}。视觉规范：${brand.style}。${brand.colors.length ? `参考配色：${brand.colors.join('、')}。` : ''}避免：${brand.avoid}`);
  if (useMascot) parts.push(`角色触发词：${brand.mascot.trigger}。角色特征：${brand.mascot.description}。保持角色身份和标志性特征一致。`);
  return {
    prompt: parts.join('\n\n'), image_size: sizes[ratio], num_images: count, output_format: 'png',
    enable_safety_checker: true,
    loras: useMascot ? [{ path: brand.mascot.loraUrl, scale: brand.mascot.scale }] : []
  };
}
