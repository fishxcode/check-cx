#!/usr/bin/env node

/**
 * 配置模板 API 测试脚本
 * 用于验证 /api/admin/config-templates 端点功能
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function testGetTemplates() {
  console.log('测试 GET /api/admin/config-templates');

  try {
    const response = await fetch(`${BASE_URL}/api/admin/config-templates`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    console.log('状态码:', response.status);
    console.log('返回数据:', JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log('✓ 测试通过 - 获取到', data.count, '个模板');
    } else {
      console.log('✗ 测试失败 -', data.error);
    }
  } catch (error) {
    console.error('✗ 请求失败:', error.message);
  }

  console.log('\n');
}

async function testGetTemplatesByCategory(category) {
  console.log(`测试 GET /api/admin/config-templates?category=${category}`);

  try {
    const response = await fetch(`${BASE_URL}/api/admin/config-templates?category=${category}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    console.log('状态码:', response.status);

    if (response.ok) {
      console.log('✓ 测试通过 - 获取到', data.count, '个', category, '类型模板');
      console.log('模板列表:', data.templates.map(t => t.name).join(', '));
    } else {
      console.log('✗ 测试失败 -', data.error);
    }
  } catch (error) {
    console.error('✗ 请求失败:', error.message);
  }

  console.log('\n');
}

async function runTests() {
  console.log('==========================================');
  console.log('配置模板 API 测试');
  console.log('==========================================\n');

  await testGetTemplates();
  await testGetTemplatesByCategory('header');
  await testGetTemplatesByCategory('metadata');
  await testGetTemplatesByCategory('both');

  console.log('==========================================');
  console.log('测试完成');
  console.log('==========================================');
}

runTests();
