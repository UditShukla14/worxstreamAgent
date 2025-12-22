/**
 * HTTP Client Service for Worxstream API
 */

import axios from 'axios';
import { config } from '../config/index.js';

// Clean base URL - remove trailing slashes
const baseUrl = config.worxstream.baseUrl.replace(/\/+$/, '');

// Check if baseUrl already ends with /api
const apiBaseUrl = baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;

const httpClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// Request interceptor - add auth token
httpClient.interceptors.request.use(
  (requestConfig) => {
    if (config.worxstream.apiToken) {
      requestConfig.headers.Authorization = `Bearer ${config.worxstream.apiToken}`;
    }
    return requestConfig;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - normalize responses
httpClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;
    const url = error.config?.url;
    console.error(`API Error [${status}] ${url}: ${message}`);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    return Promise.reject(new Error(message));
  }
);

/**
 * Call Worxstream API
 * 
 * For GET requests: data is sent as query params
 * For POST/PUT/DELETE requests: data is sent as request body
 */
export async function callWorxstreamAPI({ method, endpoint, data, params }) {
  try {
    const lowerMethod = method.toLowerCase();
    
    // For GET requests, send data as query params
    // For other methods, send data as request body
    const requestConfig = {
      method: lowerMethod,
      url: endpoint,
    };

    if (lowerMethod === 'get') {
      // Merge data into params for GET requests
      requestConfig.params = { ...data, ...params };
    } else {
      requestConfig.data = data;
      requestConfig.params = params;
    }

    const response = await httpClient.request(requestConfig);

    return {
      success: true,
      data: response.data,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export { httpClient };
