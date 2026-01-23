const fs = require('fs');
const { createCanvas } = require('canvas');

// 绘制图标的函数
function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 启用抗锯齿
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 缩放比例
  const scale = size / 128;

  // 背景渐变
  const bgGradient = ctx.createLinearGradient(0, 0, size, size);
  bgGradient.addColorStop(0, '#f5f7fa');
  bgGradient.addColorStop(1, '#e0e7ff');

  // 绘制圆角矩形背景
  const radius = 24 * scale;
  ctx.fillStyle = bgGradient;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();

  // 书签渐变
  const bookmarkGradient = ctx.createLinearGradient(0, 0, size, size);
  bookmarkGradient.addColorStop(0, '#818cf8');
  bookmarkGradient.addColorStop(1, '#6366f1');

  // 绘制书签形状
  ctx.fillStyle = bookmarkGradient;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(45 * scale, 30 * scale);
  ctx.lineTo(83 * scale, 30 * scale);
  ctx.quadraticCurveTo(88 * scale, 30 * scale, 88 * scale, 35 * scale);
  ctx.lineTo(88 * scale, 90 * scale);
  ctx.lineTo(64 * scale, 75 * scale);
  ctx.lineTo(40 * scale, 90 * scale);
  ctx.lineTo(40 * scale, 35 * scale);
  ctx.quadraticCurveTo(40 * scale, 30 * scale, 45 * scale, 30 * scale);
  ctx.closePath();
  ctx.fill();

  // 书签装饰线
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = 'white';
  ctx.fillRect(48 * scale, 40 * scale, 32 * scale, 3 * scale);

  ctx.globalAlpha = 0.3;
  ctx.fillRect(48 * scale, 48 * scale, 24 * scale, 2.5 * scale);
  ctx.fillRect(48 * scale, 55 * scale, 28 * scale, 2.5 * scale);

  // 搜索放大镜渐变
  const searchGradient = ctx.createLinearGradient(0, 0, size, size);
  searchGradient.addColorStop(0, '#a5b4fc');
  searchGradient.addColorStop(1, '#818cf8');

  // 绘制放大镜圆圈
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = searchGradient;
  ctx.lineWidth = 5 * scale;
  ctx.beginPath();
  ctx.arc(85 * scale, 85 * scale, 16 * scale, 0, Math.PI * 2);
  ctx.stroke();

  // 放大镜内部高光
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(82 * scale, 82 * scale, 6 * scale, 0, Math.PI * 2);
  ctx.fill();

  // 放大镜手柄
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = searchGradient;
  ctx.lineWidth = 5 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(96 * scale, 96 * scale);
  ctx.lineTo(106 * scale, 106 * scale);
  ctx.stroke();

  // 装饰光点
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(50 * scale, 45 * scale, 2 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(70 * scale, 42 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.arc(95 * scale, 70 * scale, 1.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

// 生成不同尺寸的图标
const sizes = [16, 48, 128];

sizes.forEach(size => {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(`icons/icon-${size}.png`, buffer);
  console.log(`✓ Generated icon-${size}.png`);
});

console.log('\n✨ All icons generated successfully!');
