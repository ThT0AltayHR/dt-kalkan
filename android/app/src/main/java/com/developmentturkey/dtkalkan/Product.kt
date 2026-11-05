package com.developmentturkey.dtkalkan

import org.json.JSONObject

/** Branding — generated from mobile/product.properties (single source of truth). */
object Product {
    val name = BuildConfig.PRODUCT_NAME
    val shortName = BuildConfig.PRODUCT_SHORT
    val company = BuildConfig.COMPANY
    val year = BuildConfig.YEAR
    val version = BuildConfig.VERSION_NAME
    val website = BuildConfig.WEBSITE
    val supportEmail = BuildConfig.SUPPORT_EMAIL
    val copyright get() = "© $year $company. Tüm hakları saklıdır."
    val copyrightEn get() = "© $year $company. All rights reserved."
    fun json(): JSONObject = JSONObject().put("name", name).put("shortName", shortName).put("company", company).put("appId", BuildConfig.APPLICATION_ID)
        .put("version", version).put("year", year).put("website", website).put("supportEmail", supportEmail).put("copyright", copyright).put("copyrightEn", copyrightEn)
}
