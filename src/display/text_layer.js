/* Copyright 2015 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define('pdfjs/display/text_layer', ['exports', 'pdfjs/shared/util',
      'pdfjs/display/dom_utils', 'pdfjs/shared/global'], factory);
  } else if (typeof exports !== 'undefined') {
    factory(exports, require('../shared/util.js'), require('./dom_utils.js'),
      require('../shared/global.js'));
  } else {
    factory((root.pdfjsDisplayTextLayer = {}), root.pdfjsSharedUtil,
      root.pdfjsDisplayDOMUtils, root.pdfjsSharedGlobal);
  }
}(this, function (exports, sharedUtil, displayDOMUtils, sharedGlobal) {

var Util = sharedUtil.Util;
var createPromiseCapability = sharedUtil.createPromiseCapability;
var CustomStyle = displayDOMUtils.CustomStyle;
var PDFJS = sharedGlobal.PDFJS;

/**
 * Text layer render parameters.
 *
 * @typedef {Object} TextLayerRenderParameters
 * @property {TextContent} textContent - Text content to render (the object is
 *   returned by the page's getTextContent() method).
 * @property {HTMLElement} container - HTML element that will contain text runs.
 * @property {HTMLElement} textAnnotationsLayerDiv - HTML element for text annotations
 * @property {Map} annotationsMap - map containing annotations element ids and styles
 * @property {PDFJS.PageViewport} viewport - The target viewport to properly
 *   layout the text runs.
 * @property {Array} textDivs - (optional) HTML elements that are correspond
 *   the text items of the textContent input. This is output and shall be
 *   initially be set to empty array.
 * @property {number} timeout - (optional) Delay in milliseconds before
 *   rendering of the text  runs occurs.
 */
var renderTextLayer = (function renderTextLayerClosure() {
  var MAX_TEXT_DIVS_TO_RENDER = 100000;

  var NonWhitespaceRegexp = /\S/;

  function isAllWhitespace(str) {
    return !NonWhitespaceRegexp.test(str);
  }

  var StandardBlockElements = {
    P:1, H:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, L:1,
    LBL:1, LI:1, LBODY:1, TABLE:1
  };

  var PDFElementsToHTMLMap = {
    Link: 'a'
  };

  function getHTMLType(pdftype, roleMap) {
    var type = roleMap[pdftype] || pdftype;
    return PDFElementsToHTMLMap[type] || type;
  }

  function isBlockElement(element, roleMap) {
    var type = element.S;
    if (type in StandardBlockElements){
      return true;
    }
    if (type in roleMap &&
        roleMap[type].toUpperCase() in StandardBlockElements) {
      return true;
    }
  }

  function createParents(markedContent, textLayerFrag, structs, roleMap) {
      var firstparent = structs[markedContent.parentid];
      var parent = firstparent;
      var child;
      while (parent) {
        if (parent._element) {
          if (child && !child._element.parentNode) {
            parent._element.appendChild(child._element);
          }
          break;
        } else {
          var type = getHTMLType(parent.S, roleMap);
          parent._element = document.createElement(type);
          if (child) {
            parent._element.appendChild(child._element);
          } else {
            //parent._element.setAttribute('MCID', markedContent.MCID);
          }
          if (isBlockElement(parent, roleMap)) {
            textLayerFrag.appendChild(parent._element);
            break;
          }
          child = parent;
          parent = structs[parent.parentid];
        }
      }
      if (!parent && child && !child._element.parentNode) {
        textLayerFrag.appendChild(child._element);
      }
      return firstparent;
  }

  function appendText(textDivs, viewport, geom, styles) {
    var style = styles[geom.fontName];
    var textDiv = document.createElement('div');
    textDivs.push(textDiv);
    if (isAllWhitespace(geom.str)) {
      textDiv.dataset.isWhitespace = true;
      return;
    }
    var tx = Util.transform(viewport.transform, geom.transform);
    var angle = Math.atan2(tx[1], tx[0]);
    if (style.vertical) {
      angle += Math.PI / 2;
    }
    var fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
    var fontAscent = fontHeight;
    if (style.ascent) {
      fontAscent = style.ascent * fontAscent;
    } else if (style.descent) {
      fontAscent = (1 + style.descent) * fontAscent;
    }

    var left;
    var top;
    if (angle === 0) {
      left = tx[4];
      top = tx[5] - fontAscent;
    } else {
      left = tx[4] + (fontAscent * Math.sin(angle));
      top = tx[5] - (fontAscent * Math.cos(angle));
    }
    textDiv.style.left = left + 'px';
    textDiv.style.top = top + 'px';
    textDiv.style.fontSize = fontHeight + 'px';
    textDiv.style.fontFamily = style.fontFamily;

    textDiv.textContent = geom.str;
    // |fontName| is only used by the Font Inspector. This test will succeed
    // when e.g. the Font Inspector is off but the Stepper is on, but it's
    // not worth the effort to do a more accurate test.
    if (PDFJS.pdfBug) {
      textDiv.dataset.fontName = geom.fontName;
    }
    // Storing into dataset will convert number into string.
    if (angle !== 0) {
      textDiv.dataset.angle = angle * (180 / Math.PI);
    }
    // We don't bother scaling single-char text divs, because it has very
    // little effect on text highlighting. This makes scrolling on docs with
    // lots of such divs a lot faster.
    if (geom.str.length > 1) {
      if (style.vertical) {
        textDiv.dataset.canvasWidth = geom.height * viewport.scale;
      } else {
        textDiv.dataset.canvasWidth = geom.width * viewport.scale;
      }
    }
  }

  function render(task) {
    if (task._canceled) {
      return;
    }
    var textLayerFrag = task._container;
    var textAnnotationsLayerDiv = task._textAnnotationsLayerDiv;
    var textDivs = task._textDivs;
    var textItems = task._textContent.items;
    var structs = task._textContent.structs;
    var roleMap = task._textContent.roleMap;
    var capability = task._capability;
    var annotationsMap = task._annotationsMap;
    var textDivsLength = textDivs.length;

    // No point in rendering many divs as it would make the browser
    // unusable even after the divs are rendered.
    if (textDivsLength > MAX_TEXT_DIVS_TO_RENDER) {
      capability.resolve();
      return;
    }

    var canvas = document.createElement('canvas');
//#if MOZCENTRAL || FIREFOX || GENERIC
    canvas.mozOpaque = true;
//#endif
    var ctx = canvas.getContext('2d', {alpha: false});

    var lastFontSize;
    var lastFontFamily;
    var pageIdx = task._pageIdx;
    var MCIDOffsets = {};
    var mcid;
    for (var i = 0; i < textDivsLength; i++) {
      var textDiv = textDivs[i];
      var textItem = textItems[i];
      if (textItem.markedContent) {
        mcid = textItem.markedContent.MCID;
        if (!MCIDOffsets[mcid]) {
          MCIDOffsets[mcid] = 0;
        }
        MCIDOffsets[mcid] += textItem.str.length;
      }
      if (textDiv.dataset.isWhitespace !== undefined) {
        continue;
      }

      var fontSize = textDiv.style.fontSize;
      var fontFamily = textDiv.style.fontFamily;

      // Only build font string and set to context if different from last.
      if (fontSize !== lastFontSize || fontFamily !== lastFontFamily) {
        ctx.font = fontSize + ' ' + fontFamily;
        lastFontSize = fontSize;
        lastFontFamily = fontFamily;
      }

      var width = ctx.measureText(textDiv.textContent).width;
      if (width > 0) {
        textDiv.setAttribute('textLayerDiv', true);
        if (textItem.markedContent) {
          var parent = createParents(textItem.markedContent, textLayerFrag,
                                     structs, roleMap);
          parent._element.appendChild(textDiv);
          var fullMCID = pageIdx + '/' + mcid;
          textDiv.setAttribute('MCID', fullMCID);
          textDiv.setAttribute('startoffset', MCIDOffsets[mcid]);
          var annotationStyle = annotationsMap ? annotationsMap.get(fullMCID) : undefined;
          if (annotationStyle) {
            var annotationSpan = document.createElement('span');
            annotationSpan.style.left = textDiv.style.left;
            annotationSpan.style.top = textDiv.style.top;
            annotationSpan.style.fontSize = textDiv.style.fontSize;
            annotationSpan.style.fontFamily = textDiv.style.fontFamily;
            annotationSpan.style.transform = textDiv.style.transform;
	    annotationSpan.style.width = (textDiv.dataset.canvasWidth ? textDiv.dataset.canvasWidth : width) + 'px';
            annotationSpan.style.height = fontSize;
            annotationSpan.style.opacity = 0.2;
            annotationSpan.style.position = 'absolute';
            annotationSpan.classList.add(annotationStyle);
            textAnnotationsLayerDiv.appendChild(annotationSpan);
          }
        } else {
          textLayerFrag.appendChild(textDiv);
        }
        var transform;
        if (textDiv.dataset.canvasWidth !== undefined) {
          // Dataset values come of type string.
          var textScale = textDiv.dataset.canvasWidth / width;
          transform = 'scaleX(' + textScale + ')';
        } else {
          transform = '';
        }
        var rotation = textDiv.dataset.angle;
        if (rotation) {
          transform = 'rotate(' + rotation + 'deg) ' + transform;
        }
        if (transform) {
          CustomStyle.setProp('transform' , textDiv, transform);
        }
      }
    }
    capability.resolve();
  }

  /**
   * Text layer rendering task.
   *
   * @param {TextContent} textContent
   * @param {HTMLElement} container
   * @param {PDFJS.PageViewport} viewport
   * @param {Array} textDivs
   * @private
   */
  function TextLayerRenderTask(textContent, container, textAnnotationsLayerDiv,
                               annotationsMap,
                               viewport, textDivs,
                               pageIdx) {
    this._textContent = textContent;
    this._textAnnotationsLayerDiv = textAnnotationsLayerDiv;
    this._annotationsMap = annotationsMap;
    this._container = container;
    this._viewport = viewport;
    textDivs = textDivs || [];
    this._textDivs = textDivs;
    this._pageIdx = pageIdx;
    this._canceled = false;
    this._capability = createPromiseCapability();
    this._renderTimer = null;
  }
  TextLayerRenderTask.prototype = {
    get promise() {
      return this._capability.promise;
    },

    cancel: function TextLayer_cancel() {
      this._canceled = true;
      if (this._renderTimer !== null) {
        clearTimeout(this._renderTimer);
        this._renderTimer = null;
      }
      this._capability.reject('canceled');
    },

    _render: function TextLayer_render(timeout) {
      var textItems = this._textContent.items;
      var textDivs = this._textDivs;
      var viewport = this._viewport;
      for (var i = 0, len = textItems.length; i < len; i++) {
        appendText(textDivs, viewport, textItems[i], this._textContent.styles);
      }

      if (!timeout) { // Render right away
        render(this);
      } else { // Schedule
        var self = this;
        this._renderTimer = setTimeout(function() {
          render(self);
          self._renderTimer = null;
        }, timeout);
      }
    }
  };


  /**
   * Starts rendering of the text layer.
   *
   * @param {TextLayerRenderParameters} renderParameters
   * @returns {TextLayerRenderTask}
   */
  function renderTextLayer(renderParameters) {
    var task = new TextLayerRenderTask(renderParameters.textContent,
                                       renderParameters.container,
                                       renderParameters.textAnnotationsLayerDiv,
                                       renderParameters.annotationsMap,
                                       renderParameters.viewport,
                                       renderParameters.textDivs,
                                       renderParameters.pageIdx);
    task._render(renderParameters.timeout);
    return task;
  }

  return renderTextLayer;
})();

PDFJS.renderTextLayer = renderTextLayer;

exports.renderTextLayer = renderTextLayer;
}));
